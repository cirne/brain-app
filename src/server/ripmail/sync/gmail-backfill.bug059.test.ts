/**
 * BUG-059: Gmail backfill throttling — lane concurrency, pipelined list→fetch, quota retry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { prepareRipmailDb, closeRipmailDb } from '../db.js'
import {
  GMAIL_BACKFILL_MESSAGES_GET_CONCURRENCY,
  GMAIL_MESSAGES_GET_CONCURRENCY,
  syncGmailSource,
  BACKFILL_COMPLETE_MAX_FAILURE_RATE,
} from './gmail.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import * as gmailRateLimit from './gmailRateLimit.js'

const gg = vi.hoisted(() => {
  const messagesList = vi.fn()
  const messagesGet = vi.fn()
  const historyList = vi.fn()
  const getProfile = vi.fn(async () => ({
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
        getProfile: (..._args: unknown[]) => gg.getProfile(),
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

function quotaError(): Error & { code: number } {
  const e = new Error('Quota exceeded') as Error & { code: number }
  e.code = 429
  return e
}

async function gmailHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'gmail-bug059-'))
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

describe('BUG-059 gmail backfill throttling', () => {
  let home: string

  beforeEach(async () => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.spyOn(gmailRateLimit, 'withGmailRetry').mockImplementation((fn) => fn())
    home = await gmailHome()
    gg.historyList.mockResolvedValue({ data: { history: [] } })
    gg.getProfile.mockResolvedValue({ data: { historyId: '424242' } })
    gg.messagesGet.mockImplementation(async (params: { id?: string }) => ({
      data: {
        id: params.id,
        raw: Buffer.from(`Message-ID: <m-${params.id}@test>\r\n\r\nbody`).toString('base64url'),
        labelIds: ['INBOX'],
        historyId: '99',
      },
    }))
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

  it('GMAIL_BACKFILL_MESSAGES_GET_CONCURRENCY is lower than refresh concurrency', () => {
    expect(GMAIL_BACKFILL_MESSAGES_GET_CONCURRENCY).toBeLessThan(GMAIL_MESSAGES_GET_CONCURRENCY)
  })

  it('pipelines list pages: messages.get before second messages.list', async () => {
    const callOrder: string[] = []
    gg.messagesList
      .mockImplementationOnce(async () => {
        callOrder.push('list1')
        return { data: { messages: [{ id: 'a' }], nextPageToken: 'tok2' } }
      })
      .mockImplementationOnce(async () => {
        callOrder.push('list2')
        return { data: { messages: [{ id: 'b' }] } }
      })
    gg.messagesGet.mockImplementation(async (params: { id?: string }) => {
      callOrder.push(`get:${params.id}`)
      return {
        data: {
          id: params.id,
          raw: Buffer.from(`Message-ID: <m-${params.id}@test>\r\n\r\nbody`).toString('base64url'),
          labelIds: ['INBOX'],
          historyId: '99',
        },
      }
    })

    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, { historicalSince: '1y' })

    const list1 = callOrder.indexOf('list1')
    const getA = callOrder.indexOf('get:a')
    const list2 = callOrder.indexOf('list2')
    expect(list1).toBeGreaterThanOrEqual(0)
    expect(getA).toBeGreaterThan(list1)
    expect(list2).toBeGreaterThan(getA)
  })

  it('updates backfillListedTarget incrementally across pages', async () => {
    gg.messagesList
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'a' }, { id: 'b' }], nextPageToken: 'p2' },
      })
      .mockResolvedValueOnce({
        data: { messages: [{ id: 'c' }] },
      })

    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, { historicalSince: '90d' })

    const row = db
      .prepare(`SELECT total_messages FROM sync_summary WHERE id = 2`)
      .get() as { total_messages: number }
    expect(row.total_messages).toBe(3)
  })

  it('caps in-flight messages.get during backfill', async () => {
    let inFlight = 0
    let maxInFlight = 0
    gg.messagesList.mockResolvedValue({
      data: {
        messages: Array.from({ length: 12 }, (_, i) => ({ id: `id${i}` })),
      },
    })
    gg.messagesGet.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>((r) => {
        queueMicrotask(r)
      })
      inFlight--
      return {
        data: {
          raw: Buffer.from('Message-ID: <x@test>\r\n\r\nb').toString('base64url'),
          labelIds: [],
          historyId: '1',
        },
      }
    })

    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, { historicalSince: '30d' })

    expect(maxInFlight).toBeLessThanOrEqual(GMAIL_BACKFILL_MESSAGES_GET_CONCURRENCY)
  })

  it('refresh lane allows higher messages.get concurrency', async () => {
    let maxInFlight = 0
    let inFlight = 0
    const ids = Array.from({ length: 16 }, (_, i) => ({ id: `r${i}` }))
    gg.messagesList.mockResolvedValue({ data: { messages: ids } })
    gg.messagesGet.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>((r) => {
        setTimeout(r, 5)
      })
      inFlight--
      return {
        data: {
          raw: Buffer.from('Message-ID: <r@test>\r\n\r\nb').toString('base64url'),
          labelIds: [],
          historyId: '1',
        },
      }
    })

    vi.useFakeTimers()
    const db = await prepareRipmailDb(home)
    const p = syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, undefined)
    await vi.advanceTimersByTimeAsync(500)
    await p
    vi.useRealTimers()

    expect(maxInFlight).toBeGreaterThan(GMAIL_BACKFILL_MESSAGES_GET_CONCURRENCY)
    expect(maxInFlight).toBeLessThanOrEqual(GMAIL_MESSAGES_GET_CONCURRENCY)
  })

  it('retries messages.get on quota error then succeeds', async () => {
    gg.messagesList.mockResolvedValue({ data: { messages: [{ id: 'retry1' }] } })
    let calls = 0
    gg.messagesGet.mockImplementation(async () => {
      calls++
      if (calls === 1) throw quotaError()
      return {
        data: {
          raw: Buffer.from('Message-ID: <retry1@test>\r\n\r\nb').toString('base64url'),
          labelIds: ['INBOX'],
          historyId: '1',
        },
      }
    })

    vi.spyOn(gmailRateLimit, 'withGmailRetry').mockImplementation(async (fn, opts) => {
      try {
        return await fn()
      } catch (e) {
        if (gmailRateLimit.isGmailQuotaError(e)) {
          return gmailRateLimit.withGmailRetry(fn, { ...opts, maxAttempts: 2, sleep: async () => {} })
        }
        throw e
      }
    })

    const db = await prepareRipmailDb(home)
    const result = await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, {
      historicalSince: '30d',
    })

    expect(calls).toBeGreaterThanOrEqual(2)
    expect(result.fetchFailures ?? 0).toBe(0)
    expect(result.messagesAdded).toBe(1)
  })

  it('surfaces result.error when all gets fail', async () => {
    gg.messagesList.mockResolvedValue({ data: { messages: [{ id: 'f1' }] } })
    gg.messagesGet.mockRejectedValue(quotaError())

    const db = await prepareRipmailDb(home)
    const result = await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, {
      historicalSince: '30d',
    })

    expect(result.fetchFailures).toBe(1)
    expect(result.error).toMatch(/All Gmail message fetches failed/)
  })

  it('logs quotaExhausted on message-fetch-error after retries exhausted', async () => {
    gg.messagesList.mockResolvedValue({ data: { messages: [{ id: 'f1' }, { id: 'f2' }] } })
    gg.messagesGet.mockRejectedValue(quotaError())

    const warnSpy = vi.spyOn(brainLogger, 'warn')

    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, { historicalSince: '30d' })

    const fetchErr = warnSpy.mock.calls.filter(
      (c) => c[1] === 'ripmail:gmail:message-fetch-error',
    )
    expect(fetchErr.length).toBeGreaterThan(0)
    expect(fetchErr.some((c) => (c[0] as { quotaExhausted?: boolean }).quotaExhausted === true)).toBe(
      true,
    )
    warnSpy.mockRestore()
  })

  it('does not markFirstBackfillCompleted when failure rate exceeds threshold', async () => {
    expect(BACKFILL_COMPLETE_MAX_FAILURE_RATE).toBe(0)
    gg.messagesList.mockResolvedValue({
      data: { messages: [{ id: 'ok' }, { id: 'bad' }] },
    })
    gg.messagesGet.mockImplementation(async (params: { id?: string }) => {
      if (params.id === 'bad') throw quotaError()
      return {
        data: {
          raw: Buffer.from('Message-ID: <ok@test>\r\n\r\nb').toString('base64url'),
          labelIds: [],
          historyId: '1',
        },
      }
    })

    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, { historicalSince: '1y' })

    const row = db
      .prepare(`SELECT first_backfill_completed_at FROM source_sync_meta WHERE source_id = ?`)
      .get('gsrc') as { first_backfill_completed_at: string } | undefined
    expect(row?.first_backfill_completed_at?.trim() ?? '').toBe('')
  })

  it('markFirstBackfillCompleted when all gets succeed for 1y', async () => {
    gg.messagesList.mockResolvedValue({ data: { messages: [{ id: 'ok1' }] } })

    const db = await prepareRipmailDb(home)
    await syncGmailSource(db, home, 'gsrc', 'a@gmail.com', oauthTokens, { historicalSince: '1y' })

    const row = db
      .prepare(`SELECT first_backfill_completed_at FROM source_sync_meta WHERE source_id = ?`)
      .get('gsrc') as { first_backfill_completed_at: string }
    expect(row.first_backfill_completed_at.trim().length).toBeGreaterThan(0)
  })
})
