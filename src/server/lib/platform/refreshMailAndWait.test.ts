import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const runRipmailHeavyArgvMock = vi.hoisted(() => vi.fn())

vi.mock('@server/lib/ripmail/ripmailHeavySpawn.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@server/lib/ripmail/ripmailHeavySpawn.js')>()
  return {
    ...actual,
    runRipmailHeavyArgv: runRipmailHeavyArgvMock,
  }
})

vi.mock('@server/lib/platform/googleOAuth.js', () => ({
  ensureGoogleOAuthImapSiblingSources: vi.fn().mockResolvedValue(undefined),
}))

import { refreshMailAndWait } from './syncAll.js'
import { RipmailTimeoutError } from '@server/lib/ripmail/ripmailRun.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'refresh-mail-wait-'))
  process.env.BRAIN_HOME = brainHome
  runRipmailHeavyArgvMock.mockReset()
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('refreshMailAndWait', () => {
  it('returns ok:false with timedOut when ripmail hits RipmailTimeoutError', async () => {
    runRipmailHeavyArgvMock.mockRejectedValueOnce(
      new RipmailTimeoutError({
        stdout: '',
        stderr: '',
        code: null,
        signal: null,
        durationMs: 90_000,
        timedOut: true,
        pid: 1,
      }),
    )
    const r = await refreshMailAndWait(90_000)
    expect(r.ok).toBe(false)
    expect(r.timedOut).toBe(true)
    expect(r.error).toMatch(/timed out/i)
  })

  it('returns ok:true when refresh completes', async () => {
    runRipmailHeavyArgvMock.mockResolvedValueOnce(undefined)
    const r = await refreshMailAndWait(5000)
    expect(r.ok).toBe(true)
    expect(r.timedOut).toBeUndefined()
  })
})
