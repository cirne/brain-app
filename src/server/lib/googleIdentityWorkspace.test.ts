import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deriveWorkspaceHandleSeed,
  googleIdentityKey,
  resolveOrProvisionWorkspace,
} from './googleIdentityWorkspace.js'
import { lookupWorkspaceByIdentity } from './tenantRegistry.js'

describe('googleIdentityWorkspace', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
  })

  it('deriveWorkspaceHandleSeed maps email local-part', () => {
    expect(deriveWorkspaceHandleSeed('Alice.Bob@example.com', 'sub')).toMatch(/^alice-bob/)
  })

  it('resolveOrProvisionWorkspace creates tenant dir + identity mapping', async () => {
    const root = join(tmpdir(), `idw-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    process.env.BRAIN_DATA_ROOT = root

    const sub = 'google-sub-new-user'
    const email = 'newbie@gmail.com'
    const key = googleIdentityKey(sub)

    const { workspaceHandle, isNew } = await resolveOrProvisionWorkspace(sub, email)
    expect(isNew).toBe(true)
    expect(workspaceHandle.length).toBeGreaterThanOrEqual(3)

    expect(await lookupWorkspaceByIdentity(key)).toBe(workspaceHandle)

    const regRaw = readFileSync(join(root, '.global', 'tenant-registry.json'), 'utf-8')
    const reg = JSON.parse(regRaw) as { identities?: Record<string, string> }
    expect(reg.identities?.[key]).toBe(workspaceHandle)

    rmSync(root, { recursive: true, force: true })
  })

  it('resolveOrProvisionWorkspace returns existing mapping for returning user', async () => {
    const root = join(tmpdir(), `idw-ret-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    process.env.BRAIN_DATA_ROOT = root

    const sub = 'stable-sub-xyz'
    const email = 'someone@gmail.com'

    const first = await resolveOrProvisionWorkspace(sub, email)
    const second = await resolveOrProvisionWorkspace(sub, email)

    expect(second.isNew).toBe(false)
    expect(second.workspaceHandle).toBe(first.workspaceHandle)

    rmSync(root, { recursive: true, force: true })
  })

  it('uses suffix when base handle directory is taken by another identity', async () => {
    const root = join(tmpdir(), `idw-coll-${Date.now()}`)
    mkdirSync(root, { recursive: true })
    process.env.BRAIN_DATA_ROOT = root

    const email = 'same@gmail.com'

    const a = await resolveOrProvisionWorkspace('sub-first', email)
    expect(a.workspaceHandle).toMatch(/^same/)

    const b = await resolveOrProvisionWorkspace('sub-second', email)
    expect(b.workspaceHandle).not.toBe(a.workspaceHandle)
    expect(b.workspaceHandle.startsWith(a.workspaceHandle)).toBe(true)

    rmSync(root, { recursive: true, force: true })
  })
})
