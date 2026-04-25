import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ripmailRefreshEnv } from './syncAll.js'
import { ripmailHomeForBrain } from './brainHome.js'
import { ripmailProcessEnv } from '@server/lib/ripmail/ripmailExec.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'sync-all-'))
  process.env.BRAIN_HOME = brainHome
  delete process.env.RIPMAIL_HOME
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('ripmailRefreshEnv', () => {
  it('sets RIPMAIL_HOME to the same path as onboarding / status polls', () => {
    expect(ripmailRefreshEnv().RIPMAIL_HOME).toBe(ripmailHomeForBrain())
  })

  it('delegates to ripmailProcessEnv (single source for ripmail child env)', () => {
    expect(ripmailRefreshEnv()).toEqual(ripmailProcessEnv())
  })
})
