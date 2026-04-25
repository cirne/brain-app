import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createVaultSession,
  revokeVaultSession,
  validateVaultSession,
} from './vaultSessionStore.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'vault-sess-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('vaultSessionStore', () => {
  it('createVaultSession then validateVaultSession accepts id', async () => {
    const id = await createVaultSession()
    expect(await validateVaultSession(id)).toBe(true)
  })

  it('validateVaultSession rejects unknown id', async () => {
    expect(await validateVaultSession('00000000-0000-4000-8000-000000000000')).toBe(false)
  })

  it('revokeVaultSession invalidates session', async () => {
    const id = await createVaultSession()
    await revokeVaultSession(id)
    expect(await validateVaultSession(id)).toBe(false)
  })
})
