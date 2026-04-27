import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('@server/lib/ripmail/ripmailExec.js', () => ({
  execRipmailAsync: vi.fn(),
}))

vi.mock('@server/lib/hub/hubRipmailSpawn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/lib/hub/hubRipmailSpawn.js')>()
  return {
    ...actual,
    spawnRipmailRefreshSource: vi.fn(() => Promise.resolve({ ok: true })),
    spawnRipmailBackfillSource: vi.fn(() => Promise.resolve({ ok: true })),
  }
})

import { execRipmailAsync } from '@server/lib/ripmail/ripmailExec.js'
import {
  spawnRipmailBackfillSource,
  spawnRipmailRefreshSource,
} from '@server/lib/hub/hubRipmailSpawn.js'
import hubRoute from './hub.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'hub-api-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.mocked(execRipmailAsync).mockReset()
  vi.mocked(spawnRipmailRefreshSource).mockClear()
  vi.mocked(spawnRipmailBackfillSource).mockClear()
})

describe('hub routes', () => {
  it('GET /sources parses ripmail JSON', async () => {
    vi.mocked(execRipmailAsync).mockResolvedValue({
      stdout: JSON.stringify({
        sources: [
          {
            id: 'x_netjets_local',
            kind: 'localDir',
            label: 'NetJets',
            path: '/Users/me/Desktop/NetJets',
          },
          { id: 'a_gmail_com', kind: 'imap', email: 'a@gmail.com' },
        ],
      }),
      stderr: '',
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources')
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      sources: Array<{ id: string; kind: string; displayName: string; path: string | null }>
      error?: string
    }
    expect(j.error).toBeUndefined()
    expect(j.sources).toHaveLength(2)
    expect(j.sources[0]).toMatchObject({
      id: 'x_netjets_local',
      kind: 'localDir',
      displayName: 'NetJets',
      path: '/Users/me/Desktop/NetJets',
    })
    expect(j.sources[1].displayName).toBe('a@gmail.com')
  })

  it('GET /sources returns error payload when ripmail fails', async () => {
    vi.mocked(execRipmailAsync).mockRejectedValue(new Error('ripmail: nope'))
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { sources: unknown[]; error?: string }
    expect(j.sources).toEqual([])
    expect(j.error).toContain('nope')
  })

  it('POST /sources/remove runs ripmail sources remove', async () => {
    vi.mocked(execRipmailAsync).mockResolvedValue({ stdout: '{}', stderr: '' })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x_netjets_local' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
    expect(vi.mocked(execRipmailAsync)).toHaveBeenCalledWith(
      expect.stringContaining('sources remove "x_netjets_local"'),
      expect.any(Object),
    )
  })

  it('POST /sources/remove 400 when id missing', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /sources/refresh spawns ripmail refresh for one source', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'a_gmail_com' }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
    expect(vi.mocked(spawnRipmailRefreshSource)).toHaveBeenCalledWith('a_gmail_com')
    expect(vi.mocked(spawnRipmailBackfillSource)).not.toHaveBeenCalled()
  })

  it('POST /sources/refresh 400 when id missing', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /sources/backfill spawns with default since 1y', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'a_gmail_com' }),
    })
    expect(res.status).toBe(200)
    expect(vi.mocked(spawnRipmailBackfillSource)).toHaveBeenCalledWith('a_gmail_com', '1y')
  })

  it('POST /sources/backfill 400 when since invalid', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/backfill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'a_gmail_com', since: 'bogus' }),
    })
    expect(res.status).toBe(400)
    expect(vi.mocked(spawnRipmailBackfillSource)).not.toHaveBeenCalled()
  })

  it('GET /sources/mail-status returns parsed mailbox row', async () => {
    vi.mocked(execRipmailAsync).mockResolvedValue({
      stdout: JSON.stringify({
        sync: {
          staleLockInDb: false,
          refresh: {
            isRunning: false,
            lastSyncAt: '2026-04-18T12:00:00Z',
            totalMessages: 10,
            earliestSyncedDate: null,
            latestSyncedDate: null,
            targetStartDate: null,
            syncStartEarliestDate: null,
            lockHeldByLiveProcess: true,
            lockAgeMs: null,
            lockOwnerPid: null,
          },
          backfill: {
            isRunning: false,
            lastSyncAt: null,
            targetStartDate: null,
            syncStartEarliestDate: null,
            lockHeldByLiveProcess: true,
            lockAgeMs: null,
            lockOwnerPid: null,
          },
        },
        search: { indexedMessages: 10, ftsReady: 10 },
        freshness: { lastSyncAgo: { human: '2 hours ago', duration: 'PT2H' } },
        mailboxes: [
          {
            mailboxId: 'applemail_local',
            messageCount: 10,
            lastUid: 3,
            needsBackfill: false,
            earliestDate: '2025-01-01',
            latestDate: '2026-04-01',
            latestMailAgo: { human: '1 week ago', duration: 'P7D' },
          },
        ],
      }),
      stderr: '',
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/mail-status?id=applemail_local')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; mailbox?: { messageCount: number } }
    expect(j.ok).toBe(true)
    expect(j.mailbox?.messageCount).toBe(10)
  })

  it('GET /sources/mail-status 400 when id missing', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/mail-status')
    expect(res.status).toBe(400)
  })
})

describe('hub mail-prefs (visibility + default send)', () => {
  async function seedConfig(cfg: unknown): Promise<void> {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const ripmailHome = join(brainHome, 'ripmail')
    await mkdir(ripmailHome, { recursive: true })
    await writeFile(join(ripmailHome, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8')
  }

  it('GET /sources/mail-prefs returns IMAP visibility + default send', async () => {
    await seedConfig({
      defaultSendSource: 'a',
      sources: [
        { id: 'a', kind: 'imap', email: 'a@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
        { id: 'b', kind: 'imap', email: 'b@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth', search: { includeInDefault: false } },
        { id: 'cal', kind: 'googleCalendar', email: 'a@gmail.com', oauthSourceId: 'a' },
      ],
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/mail-prefs')
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      ok: boolean
      mailboxes: { id: string; email: string; includeInDefault: boolean }[]
      defaultSendSource: string | null
    }
    expect(j.ok).toBe(true)
    expect(j.defaultSendSource).toBe('a')
    expect(j.mailboxes).toEqual([
      { id: 'a', email: 'a@gmail.com', includeInDefault: true },
      { id: 'b', email: 'b@gmail.com', includeInDefault: false },
    ])
  })

  it('POST /sources/include-in-default flips the flag and persists it', async () => {
    await seedConfig({
      sources: [
        { id: 'a', kind: 'imap', email: 'a@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
      ],
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/include-in-default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'a', included: false }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; includeInDefault: boolean }
    expect(j.ok).toBe(true)
    expect(j.includeInDefault).toBe(false)

    const { readFile } = await import('node:fs/promises')
    const cfg = JSON.parse(
      await readFile(join(brainHome, 'ripmail', 'config.json'), 'utf8'),
    ) as { sources: { id: string; search?: { includeInDefault?: boolean } }[] }
    expect(cfg.sources[0].search?.includeInDefault).toBe(false)
  })

  it('POST /sources/include-in-default 400 when included missing or not boolean', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/include-in-default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'a' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /sources/include-in-default 404 when source missing', async () => {
    await seedConfig({ sources: [] })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/include-in-default', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'missing', included: false }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /sources/default-send sets and clears default', async () => {
    await seedConfig({
      sources: [
        { id: 'a', kind: 'imap', email: 'a@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
        { id: 'b', kind: 'imap', email: 'b@gmail.com', imap: { host: 'imap.gmail.com', port: 993 }, imapAuth: 'googleOAuth' },
      ],
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)

    let res = await app.request('http://localhost/api/hub/sources/default-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'b' }),
    })
    expect(res.status).toBe(200)
    let j = (await res.json()) as { ok: boolean; defaultSendSource: string | null }
    expect(j.defaultSendSource).toBe('b')

    res = await app.request('http://localhost/api/hub/sources/default-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '' }),
    })
    expect(res.status).toBe(200)
    j = (await res.json()) as { ok: boolean; defaultSendSource: string | null }
    expect(j.defaultSendSource).toBeNull()
  })

  it('POST /sources/default-send 404 / 400 for invalid ids', async () => {
    await seedConfig({
      sources: [{ id: 'cal', kind: 'googleCalendar', email: 'a@gmail.com', oauthSourceId: 'a' }],
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    let res = await app.request('http://localhost/api/hub/sources/default-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'a' }),
    })
    expect(res.status).toBe(404)

    res = await app.request('http://localhost/api/hub/sources/default-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'cal' }),
    })
    expect(res.status).toBe(400)
  })
})
