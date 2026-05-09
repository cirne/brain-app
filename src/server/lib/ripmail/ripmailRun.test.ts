import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmod, mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** NR `startSegment` is a no-op in Vitest; run work directly. */
vi.mock('@server/lib/observability/newRelicHelper.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@server/lib/observability/newRelicHelper.js')>()
  return {
    ...mod,
    withRipmailCliObservation: (
      _argv: string[],
      _label: string | undefined,
      work: () => Promise<unknown>,
    ) => work(),
  }
})

import {
  runRipmailArgv,
  execRipmailCleanYes,
  RipmailNonZeroExitError,
  RipmailTimeoutError,
  getRipmailChildDebugSnapshot,
  diagnosticTailCharBudgetForRipmailClose,
} from './ripmailRun.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'

describe('diagnosticTailCharBudgetForRipmailClose', () => {
  it('uses a short budget for signal exit without timeout (shutdown / interrupt)', () => {
    expect(diagnosticTailCharBudgetForRipmailClose('SIGTERM', false)).toBe(480)
    expect(diagnosticTailCharBudgetForRipmailClose('SIGINT', false)).toBe(480)
  })
  it('keeps full budget for timeouts (need stderr hints) or clean exit', () => {
    expect(diagnosticTailCharBudgetForRipmailClose('SIGKILL', true)).toBe(6000)
    expect(diagnosticTailCharBudgetForRipmailClose(null, false)).toBe(6000)
  })
})

describe('runRipmailArgv', () => {
  let brainHome: string
  let binDir: string

  beforeEach(async () => {
    brainHome = await mkdtemp(join(tmpdir(), 'ripmail-run-'))
    binDir = await mkdtemp(join(tmpdir(), 'ripmail-bin-'))
    process.env.BRAIN_HOME = brainHome
    process.env.RIPMAIL_HOME = join(brainHome, 'ripmail')
    process.env.NEW_RELIC_LICENSE_KEY = 'test-license'
  })

  afterEach(async () => {
    delete process.env.BRAIN_HOME
    delete process.env.RIPMAIL_HOME
    delete process.env.RIPMAIL_BIN
    delete process.env.NEW_RELIC_LICENSE_KEY
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

  it('forwards RIPMAIL_SPAWN_LABEL to ripmail child env', async () => {
    const envLog = join(binDir, 'env.log')
    const script = join(binDir, 'r-env')
    await writeFile(
      script,
      `#!/bin/sh
env | sort > ${JSON.stringify(envLog)}
exit 0
`,
      'utf-8',
    )
    await chmod(script, 0o755)
    process.env.RIPMAIL_BIN = script

    await runRipmailArgv(['status', '--json'], { timeoutMs: 5000, label: 'inbox-list' })
    const envText = await readFile(envLog, 'utf-8')
    expect(envText).toContain('RIPMAIL_SPAWN_LABEL=inbox-list')
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

    const { runRipmailHeavyArgv } = await import('@server/lib/ripmail/ripmailHeavySpawn.js')
    const home = ripmailHomeForBrain()
    expect(home).toContain(brainHome)

    const a = runRipmailHeavyArgv(['refresh'], { timeoutMs: 5000 })
    const b = runRipmailHeavyArgv(['refresh'], { timeoutMs: 5000 })
    await Promise.all([a, b])
    expect(getRipmailChildDebugSnapshot().spawnCount).toBeGreaterThanOrEqual(1)
  })
})

describe('execRipmailCleanYes', () => {
  let brainHome: string
  let binDir: string
  let logPath: string

  beforeEach(async () => {
    brainHome = await mkdtemp(join(tmpdir(), 'ripmail-clean-'))
    binDir = await mkdtemp(join(tmpdir(), 'ripmail-clean-bin-'))
    logPath = join(binDir, 'invoke.log')
    process.env.BRAIN_HOME = brainHome
    process.env.RIPMAIL_HOME = join(brainHome, 'override-ripmail')
    const fake = join(binDir, 'fake-ripmail')
    await writeFile(
      fake,
      `#!/bin/sh
echo "$RIPMAIL_HOME $@" >> ${JSON.stringify(logPath)}
exit 0
`,
      'utf-8',
    )
    await chmod(fake, 0o755)
    process.env.RIPMAIL_BIN = fake
  })

  afterEach(async () => {
    delete process.env.BRAIN_HOME
    delete process.env.RIPMAIL_HOME
    delete process.env.RIPMAIL_BIN
    await rm(brainHome, { recursive: true, force: true }).catch(() => {})
    await rm(binDir, { recursive: true, force: true }).catch(() => {})
  })

  it('runs clean once at canonical $BRAIN_HOME/<layout ripmail> even when process RIPMAIL_HOME differs', async () => {
    await execRipmailCleanYes()
    const lines = (await readFile(logPath, 'utf-8')).trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    const canonicalSeg = join(brainHome, 'ripmail')
    expect(lines[0]).toContain(canonicalSeg)
    expect(lines[0]).toContain('clean')
    expect(lines[0]).toContain('--yes')
    expect(lines[0]).not.toContain('override-ripmail')
  })

  it('runs clean once when process RIPMAIL_HOME matches canonical layout dir', async () => {
    process.env.RIPMAIL_HOME = join(brainHome, 'ripmail')
    await execRipmailCleanYes()
    const lines = (await readFile(logPath, 'utf-8')).trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('clean')
    expect(lines[0]).toContain('--yes')
  })
})
