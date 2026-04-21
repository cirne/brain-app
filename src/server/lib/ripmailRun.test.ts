import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmod, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runRipmailArgv,
  RipmailNonZeroExitError,
  RipmailTimeoutError,
  getRipmailChildDebugSnapshot,
} from './ripmailRun.js'
import { ripmailHomeForBrain } from './brainHome.js'

describe('runRipmailArgv', () => {
  let brainHome: string
  let binDir: string

  beforeEach(async () => {
    brainHome = await mkdtemp(join(tmpdir(), 'ripmail-run-'))
    binDir = await mkdtemp(join(tmpdir(), 'ripmail-bin-'))
    process.env.BRAIN_HOME = brainHome
    process.env.RIPMAIL_HOME = join(brainHome, 'ripmail')
  })

  afterEach(async () => {
    delete process.env.BRAIN_HOME
    delete process.env.RIPMAIL_HOME
    delete process.env.RIPMAIL_BIN
    await rm(brainHome, { recursive: true, force: true }).catch(() => {})
    await rm(binDir, { recursive: true, force: true }).catch(() => {})
  })

  it('rejects on nonzero exit', async () => {
    const script = join(binDir, 'r1')
    await writeFile(script, '#!/bin/sh\nexit 7\n')
    await chmod(script, 0o755)
    process.env.RIPMAIL_BIN = script

    await expect(runRipmailArgv(['status', '--json'], { timeoutMs: 5000 })).rejects.toBeInstanceOf(
      RipmailNonZeroExitError,
    )
  })

  it('times out and kills a sleeping child', async () => {
    const script = join(binDir, 'r2')
    await writeFile(script, '#!/bin/sh\nexec sleep 60\n')
    await chmod(script, 0o755)
    process.env.RIPMAIL_BIN = script

    await expect(
      runRipmailArgv(['refresh'], { timeoutMs: 200, label: 'test-sleep' }),
    ).rejects.toBeInstanceOf(RipmailTimeoutError)
    expect(getRipmailChildDebugSnapshot().inFlight).toBe(0)
  })

  it('Aborted signal rejects', async () => {
    const script = join(binDir, 'r3')
    await writeFile(script, '#!/bin/sh\nexec sleep 30\n')
    await chmod(script, 0o755)
    process.env.RIPMAIL_BIN = script

    const ac = new AbortController()
    const p = runRipmailArgv(['refresh'], { timeoutMs: 10_000, signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('concurrent refresh same home shares one flight when argv match', async () => {
    const script = join(binDir, 'r4')
    await writeFile(
      script,
      `#!/bin/sh
echo ok
exit 0
`,
    )
    await chmod(script, 0o755)
    process.env.RIPMAIL_BIN = script

    const { runRipmailHeavyArgv } = await import('./ripmailHeavySpawn.js')
    const home = ripmailHomeForBrain()
    expect(home).toContain(brainHome)

    const a = runRipmailHeavyArgv(['refresh'], { timeoutMs: 5000 })
    const b = runRipmailHeavyArgv(['refresh'], { timeoutMs: 5000 })
    await Promise.all([a, b])
    expect(getRipmailChildDebugSnapshot().spawnCount).toBeGreaterThanOrEqual(1)
  })
})
