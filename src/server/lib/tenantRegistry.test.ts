import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  lookupIdentityKeyForWorkspace,
  lookupTenantBySession,
  lookupWorkspaceByIdentity,
  registerIdentityWorkspace,
  registerSessionTenant,
  unregisterSessionTenant,
} from './tenantRegistry.js'

describe('tenantRegistry', () => {
  const prev = process.env.BRAIN_DATA_ROOT

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.BRAIN_DATA_ROOT
    } else {
      process.env.BRAIN_DATA_ROOT = prev
    }
  })

  it('register, lookup, unregister round-trip', async () => {
    const base = join(tmpdir(), `reg-${Date.now()}`)
    process.env.BRAIN_DATA_ROOT = base
    mkdirSync(base, { recursive: true })
    const sid = 'session-uuid-1'
    const workspaceHandle = 'alice-workspace'
    expect(await lookupTenantBySession(sid)).toBeNull()
    await registerSessionTenant(sid, workspaceHandle)
    expect(await lookupTenantBySession(sid)).toBe(workspaceHandle)
    const regPath = join(base, '.global', 'tenant-registry.json')
    const raw = JSON.parse(readFileSync(regPath, 'utf-8')) as { sessions: Record<string, string> }
    expect(raw.sessions[sid]).toBe(workspaceHandle)
    await unregisterSessionTenant(sid)
    expect(await lookupTenantBySession(sid)).toBeNull()
    rmSync(base, { recursive: true, force: true })
  })

  it('lookup unknown session returns null', async () => {
    const base = join(tmpdir(), `reg-${Date.now()}`)
    process.env.BRAIN_DATA_ROOT = base
    mkdirSync(base, { recursive: true })
    expect(await lookupTenantBySession('does-not-exist')).toBeNull()
    rmSync(base, { recursive: true, force: true })
  })

  it('identity registry round-trip + lookupIdentityKeyForWorkspace', async () => {
    const base = join(tmpdir(), `reg-id-${Date.now()}`)
    process.env.BRAIN_DATA_ROOT = base
    mkdirSync(base, { recursive: true })

    const key = 'google:acct-sub'
    const handle = 'workspace-one'
    expect(await lookupWorkspaceByIdentity(key)).toBeNull()
    await registerIdentityWorkspace(key, handle)
    expect(await lookupWorkspaceByIdentity(key)).toBe(handle)
    expect(await lookupIdentityKeyForWorkspace(handle)).toBe(key)

    rmSync(base, { recursive: true, force: true })
  })

  it('registry without identities field on disk defaults to empty identities', async () => {
    const base = join(tmpdir(), `reg-old-${Date.now()}`)
    process.env.BRAIN_DATA_ROOT = base
    mkdirSync(join(base, '.global'), { recursive: true })
    const regPath = join(base, '.global', 'tenant-registry.json')
    writeFileSync(regPath, JSON.stringify({ v: 1, sessions: {} }), 'utf-8')

    expect(await lookupWorkspaceByIdentity('google:x')).toBeNull()

    rmSync(base, { recursive: true, force: true })
  })
})
