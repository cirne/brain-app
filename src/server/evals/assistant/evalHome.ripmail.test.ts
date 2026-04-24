/**
 * Smoke test: eval home ripmail index (run `npm run eval:build` to populate data-eval/brain).
 * `ripmailBin()` candidate order must stay aligned with `resolveRipmailBin` in `scripts/eval/ripmailBin.mjs`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const brain = join(root, 'data-eval', 'brain')
const ripHome = join(brain, 'ripmail')
const dbSqlite = join(ripHome, 'ripmail.db')
const haveEval =
  existsSync(ripHome) && existsSync(join(ripHome, 'config.json')) && existsSync(dbSqlite)

function ripmailWorks(bin: string): boolean {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8' })
  return !r.error && r.status === 0
}

function ripmailBin(): string {
  const candidates = [join(root, 'target/release/ripmail'), join(root, 'target/debug/ripmail'), 'ripmail']
  for (const c of candidates) {
    if (c === 'ripmail' || existsSync(c)) {
      if (ripmailWorks(c)) return c
    }
  }
  return join(root, 'target/debug/ripmail')
}

function statusJson() {
  const raw = execFileSync(ripmailBin(), ['status', '--json'], {
    encoding: 'utf8',
    env: { ...process.env, RIPMAIL_HOME: ripHome, BRAIN_HOME: brain },
  })
  return JSON.parse(raw) as { search?: { indexedMessages?: number } }
}

describe('eval home ripmail', () => {
  it.skipIf(!haveEval)('indexed messages > 0 after eval:build', () => {
    const st = statusJson()
    const n = st.search?.indexedMessages ?? 0
    expect(n).toBeGreaterThan(0)
  })
})
