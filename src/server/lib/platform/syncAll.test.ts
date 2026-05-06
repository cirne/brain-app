import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const runRipmailBackfillForBrainMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    stdout: '',
    stderr: '',
    code: 0,
    signal: null,
    durationMs: 1,
    timedOut: false,
    pid: 1,
  }),
)

vi.mock('@server/lib/ripmail/ripmailHeavySpawn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/lib/ripmail/ripmailHeavySpawn.js')>()
  return { ...actual, runRipmailBackfillForBrain: runRipmailBackfillForBrainMock }
})

import { ripmailRefreshEnv, syncInboxRipmailOnboarding } from './syncAll.js'
import { ripmailHomeForBrain } from './brainHome.js'
import { ripmailProcessEnv } from '@server/lib/ripmail/ripmailRun.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'sync-all-'))
  process.env.BRAIN_HOME = brainHome
  delete process.env.RIPMAIL_HOME
  runRipmailBackfillForBrainMock.mockClear()
  runRipmailBackfillForBrainMock.mockResolvedValue({
    stdout: '',
    stderr: '',
    code: 0,
    signal: null,
    durationMs: 1,
    timedOut: false,
    pid: 1,
  })
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

describe('syncInboxRipmailOnboarding', () => {
  it('runs ripmail backfill 30d without --foreground', async () => {
    const r = await syncInboxRipmailOnboarding(undefined)
    expect(r.ok).toBe(true)
    expect(runRipmailBackfillForBrainMock).toHaveBeenCalledWith(['30d'], undefined)
  })

  it('returns { ok: false, error } when backfill fails', async () => {
    runRipmailBackfillForBrainMock.mockRejectedValueOnce(new Error('ripmail failed'))
    const r = await syncInboxRipmailOnboarding(undefined)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/ripmail failed/)
  })
})
