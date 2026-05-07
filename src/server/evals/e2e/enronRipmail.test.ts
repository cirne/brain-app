import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execRipmailArgv } from '@server/lib/ripmail/ripmailRun.js'

/** Repo root: …/src/server/evals/e2e → ../../../.. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', '..')
const evalBrain = resolve(repoRoot, 'data-eval', 'brain')
const ripmailHome = join(evalBrain, 'ripmail')
const ripmailDb = join(ripmailHome, 'ripmail.db')

/** Golden id from [eval/tasks/enron-v1.jsonl](../../../../eval/tasks/enron-v1.jsonl) (Janet Butler weekly report). */
const JANET_WEEKLY_REPORT_ID = '2322798.1075855417584.JavaMail.evans@thyme'

const ripmailEnv = { ...process.env, RIPMAIL_HOME: ripmailHome, BRAIN_HOME: evalBrain }

async function indexedMessageCount(): Promise<number> {
  const { stdout } = await execRipmailArgv(['status', '--json'], {
    env: ripmailEnv,
    timeout: 120_000,
  })
  const j = JSON.parse(stdout) as { search?: { indexedMessages?: number } }
  return j.search?.indexedMessages ?? 0
}

describe('Enron corpus ripmail E2E (data-eval/brain)', () => {
  let corpusReady = false

  beforeAll(async () => {
    if (!existsSync(ripmailDb)) return
    try {
      if (statSync(ripmailDb).size < 10_000) return
    } catch {
      return
    }
    try {
      const n = await indexedMessageCount()
      corpusReady = n >= 1_000
    } catch {
      corpusReady = false
    }
  })

  it('search with from filter returns hits in 2001', async (ctx) => {
    if (!corpusReady) ctx.skip()
    const { stdout } = await execRipmailArgv(
      [
        'search',
        'Weekly Report',
        '--from',
        'janet.butler@enron.com',
        '--after',
        '2001-11-01',
        '--before',
        '2002-01-15',
        '--json',
        '--limit',
        '5',
      ],
      { env: ripmailEnv, timeout: 120_000 },
    )
    const j = JSON.parse(stdout) as { totalMatched?: number; results?: unknown[] }
    expect(j.totalMatched ?? 0).toBeGreaterThan(0)
    expect(Array.isArray(j.results)).toBe(true)
  })

  it('read returns JSON for a known message id', async (ctx) => {
    if (!corpusReady) ctx.skip()
    const { stdout } = await execRipmailArgv(
      ['read', JANET_WEEKLY_REPORT_ID, '--json'],
      { env: ripmailEnv, timeout: 120_000 },
    )
    const j = JSON.parse(stdout) as { subject?: string; from?: string; messageId?: string }
    expect(j.messageId ?? j.subject).toBeTruthy()
    const blob = JSON.stringify(j).toLowerCase()
    expect(blob).toContain('janet')
  })

  it('who query returns contacts JSON', async (ctx) => {
    if (!corpusReady) ctx.skip()
    const { stdout } = await execRipmailArgv(['who', 'kean', '--json', '--limit', '20'], {
      env: ripmailEnv,
      timeout: 120_000,
    })
    const j = JSON.parse(stdout) as { contacts?: unknown[] } | unknown[]
    const list = Array.isArray(j) ? j : j.contacts
    expect(Array.isArray(list)).toBe(true)
    expect((list as unknown[]).length).toBeGreaterThan(0)
  })

  it('attachment list returns JSON array for a known message', async (ctx) => {
    if (!corpusReady) ctx.skip()
    const { stdout } = await execRipmailArgv(
      ['attachment', 'list', JANET_WEEKLY_REPORT_ID, '--json'],
      { env: ripmailEnv, timeout: 120_000 },
    )
    const j = JSON.parse(stdout) as unknown
    expect(Array.isArray(j)).toBe(true)
  })

  it('inbox with historical window returns JSON', async (ctx) => {
    if (!corpusReady) ctx.skip()
    const { stdout } = await execRipmailArgv(
      ['inbox', '--since', '2001-12-01', '--json'],
      { env: ripmailEnv, timeout: 120_000 },
    )
    const j = JSON.parse(stdout) as { items?: unknown[]; threads?: unknown[] }
    const keys = Object.keys(j)
    expect(keys.length).toBeGreaterThan(0)
  })
})
