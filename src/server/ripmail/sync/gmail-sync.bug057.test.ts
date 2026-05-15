/**
 * BUG-057: Gmail bootstrap window, observable logging (lane/phase), partial failure propagation,
 * and refresh orchestration log shape — asserted against desired contracts; fixes will turn these green.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { prepareRipmailDb, closeRipmailDb } from '../db.js'
import { syncGmailSource } from './gmail.js'
import { refresh } from './index.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

const DAY_SEC = 86_400

const gg = vi.hoisted(() => {
  const messagesList = vi.fn()
  const messagesGet = vi.fn()
  const historyList = vi.fn()
  const getProfile = vi.fn(async (_params?: unknown, _options?: unknown) => ({
    data: { historyId: '424242' },
  }))
  return { messagesList, messagesGet, historyList, getProfile }
})

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {}
      },
    },
    gmail: vi.fn(() => ({
      users: {
        messages: {
          list: (...args: unknown[]) => gg.messagesList(...args),
          get: (...args: unknown[]) => gg.messagesGet(...args),
        },
        history: { list: (...args: unknown[]) => gg.historyList(...args) },
        getProfile: (...args: [unknown?, unknown?]) => gg.getProfile(...args),
      },
    })),
  },
}))

const oauthTokens = {
  accessToken: 'atk',
  refreshToken: 'rtk',
  clientId: 'cid',
  clientSecret: 'csec',
}

async function gmailHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'gmail-bug057-'))
  mkdirSync(join(home, 'gsrc'), { recursive: true })
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      sources: [
        {
          id: 'gsrc',
          kind: 'imap',
          email: 'a@gmail.com',
          imapAuth: 'googleOAuth',
          imap: { host: 'imap.gmail.com', port: 993, user: 'a@gmail.com' },
        },
      ],
    }),
    'utf8',
  )
  writeFileSync(join(home, 'gsrc', 'google-oauth.json'), JSON.stringify(oauthTokens), 'utf8')
  return home
}

describe('BUG-057 gmail sync', () => {
  let home: string

  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    home = await gmailHome()
    gg.historyList.mockResolvedValue({ data: { history: [] } })
    gg.getProfile.mockResolvedValue({ data: { historyId: '424242' } })
    gg.messagesList.mockResolvedValue({ data: { messages: [] } })
    gg.messagesGet.mockResolvedValue({ data: {} })
  })

  afterEach(() => {
    closeRipmailDb(home)
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  it('BUG-057: Gmail refresh without historyId must use a mailbox lookback spanning at least ~300 days (not ~7)', async () => {
    gg.messagesList.mockResolvedValueOnce({ data: { messages: [] } })
    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, undefined)

    expect(gg.messagesList).toHaveBeenCalled()
    const firstListArg = gg.messagesList.mock.calls[0][0] as { q?: string }
    expect(firstListArg.q).toMatch(/^after:\d+$/)
    const afterEpoch = Number(/^after:(\d+)$/.exec(String(firstListArg.q))![1])
    const mustCoverAtLeastDays = 300
    /** Listed window must extend at least ~300 days into the past ⇒ cutoff epoch precedes recent week-only bootstrap. */
    const latestAcceptableCutoffEpoch = Math.floor(Date.now() / 1000) - mustCoverAtLeastDays * DAY_SEC
    expect(afterEpoch).toBeLessThanOrEqual(latestAcceptableCutoffEpoch + 10_000)
  })

  it('BUG-057: gmail:message-fetch-error logs carry lane key for NRQL segmentation', async () => {
    gg.messagesList.mockResolvedValueOnce({ data: { messages: [{ id: 'm1' }] } })
    gg.messagesGet.mockRejectedValueOnce(new Error('fetch failed'))

    const warnSpy = vi.spyOn(brainLogger, 'warn')

    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, undefined)

    const fetchErrCalls = warnSpy.mock.calls.filter(
      (call) => typeof call[1] === 'string' && call[1] === 'ripmail:gmail:message-fetch-error',
    )
    expect(fetchErrCalls.length).toBeGreaterThan(0)
    const payloads = fetchErrCalls.map(([p]) => p as Record<string, unknown>)
    expect(payloads.some((p) => typeof p.lane === 'string' && p.lane.length > 0)).toBe(true)
    warnSpy.mockRestore()
  })

  it('BUG-057: Bootstrap messages.list emits a phased log entry before downloads', async () => {
    gg.messagesList.mockResolvedValueOnce({ data: { messages: [] } })
    const infoSpy = vi.spyOn(brainLogger, 'info')

    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, undefined)

    const listPhaseEmitted = infoSpy.mock.calls.some(([payload, msg]) => {
      if (typeof msg !== 'string') return false
      if (!(msg.includes('ripmail:gmail') || msg.includes('gmail'))) return false
      return typeof payload === 'object' && payload !== null && (payload as { phase?: unknown }).phase === 'list'
    })
    expect(listPhaseEmitted).toBe(true)
    infoSpy.mockRestore()
  })

  it('BUG-057: systemic messages.get failures must surface on syncGmailSource result boundary', async () => {
    gg.messagesList.mockResolvedValueOnce({
      data: { messages: [{ id: 'a1' }, { id: 'a2' }] },
    })
    gg.messagesGet.mockRejectedValue(new Error('always fail'))

    const db = await prepareRipmailDb(home)
    const result = await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, undefined)

    const r = result as { error?: string; partialFailure?: boolean; fetchFailures?: number }
    const hasSurfacingSignal =
      String(r.error ?? '').trim().length > 0 ||
      r.partialFailure === true ||
      (typeof r.fetchFailures === 'number' && r.fetchFailures > 0)
    expect(hasSurfacingSignal).toBe(true)
  })

  it('BUG-057: ripmail:gmail:historical-list payloads include lane (backfill) for observability', async () => {
    gg.messagesList.mockResolvedValue({ data: { messages: [{ id: 'hid1' }], nextPageToken: undefined } })
    gg.messagesGet.mockRejectedValue(new Error('no raw'))

    const infoSpy = vi.spyOn(brainLogger, 'info')

    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, { historicalSince: '1y' })

    const hist = infoSpy.mock.calls.find(
      (c): c is [Record<string, unknown>, string] =>
        typeof c[1] === 'string' && c[1] === 'ripmail:gmail:historical-list',
    )
    expect(hist?.[0]).toEqual(expect.objectContaining({ lane: expect.any(String) }))
    infoSpy.mockRestore()
  })

  it('BUG-057: refresh orchestration emits lane on bounded lifecycle logs', async () => {
    gg.messagesList.mockResolvedValue({ data: { messages: [{ id: 'hid1' }], nextPageToken: undefined } })
    gg.messagesGet.mockRejectedValue(new Error('broken'))

    const infoSpy = vi.spyOn(brainLogger, 'info')

    await prepareRipmailDb(home)
    await refresh(home, { sourceId: 'gsrc', historicalSince: '1y' })

    const sawLaneBoundary = infoSpy.mock.calls.some(([payload, msg]) => {
      if (typeof payload !== 'object' || payload === null) return false
      if (typeof msg !== 'string' || !msg.startsWith('ripmail:refresh')) return false
      return typeof (payload as { lane?: unknown }).lane === 'string'
    })
    expect(sawLaneBoundary).toBe(true)
    infoSpy.mockRestore()
  })
})
