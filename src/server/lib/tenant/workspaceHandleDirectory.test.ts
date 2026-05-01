import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureTenantHomeDir, tenantHomeDir } from './dataRoot.js'
import { generateUserId, writeHandleMeta } from './handleMeta.js'
import { brainLayoutRipmailDir, brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'
import {
  resolveConfirmedHandle,
  searchWorkspaceHandleDirectory,
} from './workspaceHandleDirectory.js'

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

    const results = await searchWorkspaceHandleDirectory({ prefix: '' })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      userId: alice.userId,
      handle: 'alice',
      displayName: 'Alice Anderson',
      primaryEmail: 'alice@example.com',
    })
  })

  it('filters by case-insensitive prefix and strips leading @', async () => {
    await seedTenant({ handle: 'sterling', primaryEmail: 'sterling@example.com' })
    await seedTenant({ handle: 'donna', primaryEmail: 'donna@example.com' })
    await seedTenant({ handle: 'cirne', primaryEmail: 'cirne@example.com' })

    const sResults = await searchWorkspaceHandleDirectory({ prefix: '@St' })
    expect(sResults.map((r) => r.handle)).toEqual(['sterling'])

    const allResults = await searchWorkspaceHandleDirectory({ prefix: '' })
    expect(allResults.map((r) => r.handle)).toEqual(['cirne', 'donna', 'sterling'])
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

    const [row] = await searchWorkspaceHandleDirectory({ prefix: 'fall' })
    expect(row?.primaryEmail).toBe('fallback@example.com')
  })

  it('returns null primaryEmail when no mailbox is linked', async () => {
    await seedTenant({ handle: 'lonely' })
    const [row] = await searchWorkspaceHandleDirectory({ prefix: 'lonely' })
    expect(row?.primaryEmail).toBeNull()
  })

  it('excludes a specific tenant via excludeUserId', async () => {
    const me = await seedTenant({ handle: 'caller', primaryEmail: 'me@example.com' })
    await seedTenant({ handle: 'other', primaryEmail: 'other@example.com' })

    const results = await searchWorkspaceHandleDirectory({
      prefix: '',
      excludeUserId: me.userId,
    })
    expect(results.map((r) => r.handle)).toEqual(['other'])
  })

  it('caps results at limit', async () => {
    for (let i = 0; i < 5; i++) {
      await seedTenant({ handle: `aaa${i}`, primaryEmail: `${i}@x.com` })
    }
    const results = await searchWorkspaceHandleDirectory({ prefix: 'aaa', limit: 3 })
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
})
