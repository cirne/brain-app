/**
 * Smoke test: Kean demo tenant ripmail index (`npm run brain:seed-enron-demo`).
 * `ripmailBin()` candidate order must stay aligned with `resolveRipmailBin` in `scripts/eval/ripmailBin.mjs`.
 */
import { ENRON_DEMO_TENANT_USER_ID_DEFAULT } from '@server/lib/auth/enronDemo.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const brain = join(root, 'data', ENRON_DEMO_TENANT_USER_ID_DEFAULT)
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
  it.skipIf(!haveEval)('indexed messages > 0 after brain:seed-enron-demo', () => {
    const st = statusJson()
    const n = st.search?.indexedMessages ?? 0
    expect(n).toBeGreaterThan(0)
  })
})
