import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: vi.fn(),
  runRipmailArgv: vi.fn(),
}))

vi.mock('@server/lib/hub/hubRipmailSpawn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/lib/hub/hubRipmailSpawn.js')>()
  return {
    ...actual,
    spawnRipmailRefreshSource: vi.fn(() => Promise.resolve({ ok: true })),
    spawnRipmailBackfillSource: vi.fn(() => Promise.resolve({ ok: true })),
  }
})

import { execRipmailAsync, runRipmailArgv } from '@server/lib/ripmail/ripmailRun.js'
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
  vi.mocked(runRipmailArgv).mockReset()
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

  it('GET /sources/detail merges list and status for a Google Drive source', async () => {
    vi.mocked(execRipmailAsync).mockImplementation(async (cmd: string) => {
      if (cmd.includes('sources list')) {
        return {
          stdout: JSON.stringify({
            sources: [
              {
                id: 'drive_x',
                kind: 'googleDrive',
                email: 'u@gmail.com',
                oauthSourceId: 'mailbox_a',
                includeSharedWithMe: true,
                fileSource: {
                  roots: [{ id: 'abc', name: 'Work', recursive: true }],
                  includeGlobs: [],
                  ignoreGlobs: [],
                  maxFileBytes: 5_000_000,
                  respectGitignore: true,
                },
              },
            ],
          }),
          stderr: '',
        }
      }
      if (cmd.includes('sources status')) {
        return {
          stdout: JSON.stringify({
            sources: [
              {
                id: 'drive_x',
                kind: 'googleDrive',
                documentIndexRows: 42,
                calendarEventRows: 0,
                lastSyncedAt: '2026-04-30T10:00:00Z',
              },
            ],
          }),
          stderr: '',
        }
      }
      return { stdout: '{}', stderr: '' }
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/detail?id=drive_x')
    expect(res.status).toBe(200)
    const j = (await res.json()) as {
      ok: true
      status?: { documentIndexRows: number }
      fileSource?: { roots: { id: string }[] }
      includeSharedWithMe?: boolean
      oauthSourceId?: string | null
    }
    expect(j.ok).toBe(true)
    expect(j.status?.documentIndexRows).toBe(42)
    expect(j.fileSource?.roots.map((r) => r.id)).toEqual(['abc'])
    expect(j.includeSharedWithMe).toBe(true)
    expect(j.oauthSourceId).toBe('mailbox_a')
  })

  it('GET /sources/detail returns ok:false when source id not in config', async () => {
    vi.mocked(execRipmailAsync).mockResolvedValue({
      stdout: JSON.stringify({ sources: [{ id: 'other', kind: 'localDir', path: '/tmp' }] }),
      stderr: '',
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/detail?id=missing')
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; error?: string }
    expect(j.ok).toBe(false)
    expect(j.error).toBe('Source not found')
  })

  it('GET /sources/detail 400 when id missing', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/detail')
    expect(res.status).toBe(400)
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

  it('GET /sources/browse-folders returns folders from ripmail', async () => {
    vi.mocked(runRipmailArgv).mockResolvedValue({
      stdout: JSON.stringify({
        folders: [{ id: 'a', name: 'Alpha', hasChildren: true }],
      }),
      stderr: '',
      code: 0,
      signal: null,
      durationMs: 1,
      timedOut: false,
      pid: 1,
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request(
      'http://localhost/api/hub/sources/browse-folders?id=src1&parentId=root',
    )
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean; folders?: { id: string }[] }
    expect(j.ok).toBe(true)
    expect(j.folders?.map((f) => f.id)).toEqual(['a'])
    expect(vi.mocked(runRipmailArgv).mock.calls[0]?.[0]).toEqual([
      'sources',
      'browse-folders',
      '--id',
      'src1',
      '--json',
      '--parent-id',
      'root',
    ])
  })

  it('GET /sources/browse-folders 400 when id missing', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/browse-folders')
    expect(res.status).toBe(400)
  })

  it('POST /sources/update-file-source runs ripmail sources edit --file-source-json', async () => {
    vi.mocked(runRipmailArgv).mockResolvedValue({
      stdout: '{}',
      stderr: '',
      code: 0,
      signal: null,
      durationMs: 1,
      timedOut: false,
      pid: 1,
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const fileSource = {
      roots: [{ id: 'f1', name: 'Docs', recursive: true }],
      includeGlobs: [] as string[],
      ignoreGlobs: [] as string[],
      maxFileBytes: 9_000_000,
      respectGitignore: false,
    }
    const res = await app.request('http://localhost/api/hub/sources/update-file-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'gd1', fileSource }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
    expect(vi.mocked(runRipmailArgv).mock.calls[0]?.[0]).toEqual([
      'sources',
      'edit',
      'gd1',
      '--file-source-json',
      JSON.stringify(fileSource),
      '--json',
    ])
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

  it('POST /sources/update-include-shared-with-me calls ripmail with correct args', async () => {
    vi.mocked(runRipmailArgv).mockResolvedValue({
      stdout: '{"ok":true,"id":"drive_x"}',
      stderr: '',
      code: 0,
      signal: null,
      durationMs: 1,
      timedOut: false,
      pid: 1,
    })
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/update-include-shared-with-me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'drive_x', include: true }),
    })
    expect(res.status).toBe(200)
    const j = (await res.json()) as { ok: boolean }
    expect(j.ok).toBe(true)
    const calls = vi.mocked(runRipmailArgv).mock.calls
    const editCall = calls.find((c) => c[0].includes('edit') && c[0].includes('--include-shared-with-me'))
    expect(editCall).toBeDefined()
    expect(editCall?.[0]).toContain('true')
  })

  it('POST /sources/update-include-shared-with-me 400 when include is not boolean', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/update-include-shared-with-me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'drive_x', include: 'yes' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /sources/update-include-shared-with-me 400 when id missing', async () => {
    const app = new Hono()
    app.route('/api/hub', hubRoute)
    const res = await app.request('http://localhost/api/hub/sources/update-include-shared-with-me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ include: false }),
    })
    expect(res.status).toBe(400)
  })
})
