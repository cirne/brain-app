/**
 * Smoke test: Kean demo tenant ripmail index (`npm run brain:seed-enron-demo`).
 */
import { ENRON_DEMO_TENANT_USER_ID_DEFAULT } from '@server/lib/auth/enronDemo.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { ripmailStatus } from '@server/ripmail/index.js'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const brain = join(root, 'data', ENRON_DEMO_TENANT_USER_ID_DEFAULT)
const ripHome = join(brain, 'ripmail')
const dbSqlite = join(ripHome, 'ripmail.db')
const haveEval =
  existsSync(ripHome) && existsSync(join(ripHome, 'config.json')) && existsSync(dbSqlite)

describe('eval home ripmail', () => {
  it.skipIf(!haveEval)('indexed messages > 0 after brain:seed-enron-demo', async () => {
    const s = await ripmailStatus(ripHome)
    const n = s.indexedMessages
    expect(n).toBeGreaterThan(0)
  })
})
