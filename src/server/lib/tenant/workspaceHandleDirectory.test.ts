import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureTenantHomeDir, tenantHomeDir } from './dataRoot.js'
import { generateUserId, writeHandleMeta } from './handleMeta.js'
import { brainLayoutRipmailDir, brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'
import {
  directoryTextMatchRank,
  resolveConfirmedHandle,
  resolveConfirmedTenantEntry,
  searchWorkspaceHandleDirectory,
  workspaceHandleMatchRank,
} from './workspaceHandleDirectory.js'

describe('directoryTextMatchRank', () => {
  it('orders full string prefix before word prefix before substring', () => {
    expect(directoryTextMatchRank('alice anderson', 'alice')).toBe(0)
    expect(directoryTextMatchRank('mary alice', 'alice')).toBe(1)
    expect(directoryTextMatchRank('xxaliceyy', 'alice')).toBe(2)
    expect(directoryTextMatchRank('bob', 'z')).toBeNull()
  })
})

describe('workspaceHandleMatchRank', () => {
  it('orders full handle prefix before segment prefix before substring', () => {
    expect(workspaceHandleMatchRank('sk-demo', 'sk')).toBe(0)
    expect(workspaceHandleMatchRank('demo-jeff-skilling', 'sk')).toBe(1)
    expect(workspaceHandleMatchRank('axxskyy-prefix', 'sk')).toBe(2)
    expect(workspaceHandleMatchRank('abc', 'z')).toBeNull()
  })
})

describe('workspaceHandleDirectory', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'whd-'))
    process.env.BRAIN_DATA_ROOT = root
  })

  afterEach(async () => {
    delete process.env.BRAIN_DATA_ROOT
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
    await rm(root, { recursive: true, force: true })
  })

  async function seedTenant(opts: {
    handle: string
    confirmed?: boolean
    displayName?: string
    primaryEmail?: string
    linkedAt?: string
  }): Promise<{ userId: string; home: string }> {
    const userId = generateUserId()
    ensureTenantHomeDir(userId)
    const home = tenantHomeDir(userId)
    await writeHandleMeta(home, {
      userId,
      handle: opts.handle,
      confirmedAt: opts.confirmed === false ? null : '2026-01-01T00:00:00.000Z',
      ...(opts.displayName ? { displayName: opts.displayName } : {}),
    })
    if (opts.primaryEmail) {
      const varDir = brainLayoutVarDir(home)
      await mkdir(varDir, { recursive: true })
      await writeFile(
        join(varDir, 'linked-mailboxes.json'),
        JSON.stringify(
          {
            v: 1,
            mailboxes: [
              {
                email: opts.primaryEmail.toLowerCase(),
                googleSub: 'sub-x',
                linkedAt: opts.linkedAt ?? '2026-01-01T00:00:00.000Z',
                isPrimary: true,
              },
            ],
          },
          null,
          2,
        ),
      )
    }
    return { userId, home }
  }

  it('returns confirmed handles only, with displayName and primary email', async () => {
    const alice = await seedTenant({
      handle: 'alice',
      displayName: 'Alice Anderson',
      primaryEmail: 'alice@example.com',
    })
    await seedTenant({ handle: 'pending', confirmed: false, primaryEmail: 'p@x.com' })

    const results = await searchWorkspaceHandleDirectory({ query: '' })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      userId: alice.userId,
      handle: 'alice',
      displayName: 'Alice Anderson',
      primaryEmail: 'alice@example.com',
    })
  })

  it('matches substring in handle; sorts full prefix, then segment prefix, then infix', async () => {
    await seedTenant({ handle: 'sterling', primaryEmail: 'sterling@example.com' })
    await seedTenant({ handle: 'donna', primaryEmail: 'donna@example.com' })
    await seedTenant({ handle: 'cirne', primaryEmail: 'cirne@example.com' })

    const sResults = await searchWorkspaceHandleDirectory({ query: '@St' })
    expect(sResults.map((r) => r.handle)).toEqual(['sterling'])

    await seedTenant({ handle: 'sk-root', primaryEmail: 'a@x.com' })
    await seedTenant({ handle: 'demo-jeff-skilling', primaryEmail: 'b@x.com' })
    await seedTenant({ handle: 'zzz-demo-jeff-skilling', primaryEmail: 'c@x.com' })
    await seedTenant({ handle: 'xxskyy-test', primaryEmail: 'd@x.com' })

    const skRanked = await searchWorkspaceHandleDirectory({ query: 'sk' })
    expect(skRanked.map((r) => r.handle)).toEqual([
      'sk-root',
      'demo-jeff-skilling',
      'zzz-demo-jeff-skilling',
      'xxskyy-test',
    ])

    const allResults = await searchWorkspaceHandleDirectory({ query: '' })
    expect(allResults.map((r) => r.handle)).toEqual([
      'cirne',
      'demo-jeff-skilling',
      'donna',
      'sk-root',
      'sterling',
      'xxskyy-test',
      'zzz-demo-jeff-skilling',
    ])
  })

  it('falls back to ripmail config.json email when linked-mailboxes.json missing', async () => {
    const userId = generateUserId()
    ensureTenantHomeDir(userId)
    const home = tenantHomeDir(userId)
    await writeHandleMeta(home, {
      userId,
      handle: 'fallback',
      confirmedAt: '2026-01-01T00:00:00.000Z',
    })
    const rip = brainLayoutRipmailDir(home)
    await mkdir(rip, { recursive: true })
    await writeFile(
      join(rip, 'config.json'),
      JSON.stringify(
        {
          sources: [
            {
              id: 'mbx',
              kind: 'imap',
              email: 'Fallback@Example.com',
              imap: { host: 'imap.gmail.com', port: 993 },
              imapAuth: 'googleOAuth',
            },
          ],
        },
        null,
        2,
      ),
    )

    const [row] = await searchWorkspaceHandleDirectory({ query: 'fall' })
    expect(row?.primaryEmail).toBe('fallback@example.com')
  })

  it('returns null primaryEmail when no mailbox is linked', async () => {
    await seedTenant({ handle: 'lonely' })
    const [row] = await searchWorkspaceHandleDirectory({ query: 'lonely' })
    expect(row?.primaryEmail).toBeNull()
  })

  it('excludes a specific tenant via excludeUserId', async () => {
    const me = await seedTenant({ handle: 'caller', primaryEmail: 'me@example.com' })
    await seedTenant({ handle: 'other', primaryEmail: 'other@example.com' })

    const results = await searchWorkspaceHandleDirectory({
      query: '',
      excludeUserId: me.userId,
    })
    expect(results.map((r) => r.handle)).toEqual(['other'])
  })

  it('caps results at limit', async () => {
    for (let i = 0; i < 5; i++) {
      await seedTenant({ handle: `aaa${i}`, primaryEmail: `${i}@x.com` })
    }
    const results = await searchWorkspaceHandleDirectory({ query: 'aaa', limit: 3 })
    expect(results).toHaveLength(3)
  })

  it('resolveConfirmedHandle matches exact handle (case-insensitive)', async () => {
    const t = await seedTenant({
      handle: 'sterling',
      displayName: 'Sterling Smith',
      primaryEmail: 'sterling@example.com',
    })

    const found = await resolveConfirmedHandle({ handle: '@STERLING' })
    expect(found?.userId).toBe(t.userId)
    expect(found?.primaryEmail).toBe('sterling@example.com')

    const miss = await resolveConfirmedHandle({ handle: 'sterlin' })
    expect(miss).toBeNull()
  })

  it('resolveConfirmedHandle skips unconfirmed tenants', async () => {
    await seedTenant({ handle: 'pending', confirmed: false, primaryEmail: 'p@x.com' })
    const out = await resolveConfirmedHandle({ handle: 'pending' })
    expect(out).toBeNull()
  })

  it('matches display name substring', async () => {
    await seedTenant({
      handle: 'pat-handle',
      displayName: 'Patrizia Regulatory',
      primaryEmail: 'pat@example.com',
    })
    const r = await searchWorkspaceHandleDirectory({ query: 'regulatory' })
    expect(r.map((x) => x.handle)).toEqual(['pat-handle'])
  })

  it('matches primary email substring', async () => {
    await seedTenant({
      handle: 'em-user',
      displayName: 'E M',
      primaryEmail: 'long.name@company.test',
    })
    const r = await searchWorkspaceHandleDirectory({ query: 'company.test' })
    expect(r).toHaveLength(1)
    expect(r[0]?.handle).toBe('em-user')
  })

  it('resolveConfirmedTenantEntry returns directory row for confirmed userId', async () => {
    const t = await seedTenant({ handle: 'uid-row', displayName: 'Zed', primaryEmail: 'z@z.com' })
    const row = await resolveConfirmedTenantEntry({ userId: t.userId })
    expect(row?.handle).toBe('uid-row')
    expect(await resolveConfirmedTenantEntry({ userId: 'usr_bbbbbbbbbbbbbbbbbbbb' })).toBeNull()
  })
})
