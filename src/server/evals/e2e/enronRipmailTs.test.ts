/**
 * Enron corpus E2E for the TypeScript ripmail module (`./data` Kean demo tenant).
 *
 * Skips when the Enron corpus is not seeded. Seed: `npm run brain:seed-enron-demo`
 *
 * Readiness avoids calling `prepareRipmailDb`-backed helpers when `user_version`
 * mismatches CURRENT_SCHEMA_VERSION (would trigger full maildir rebuild and can
 * exceed the default Vitest hook timeout). Re-seed after a Ripmail schema bump.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENRON_DEMO_TENANT_USER_ID_DEFAULT } from '@server/lib/auth/enronDemo.js'
import { SCHEMA_VERSION as CURRENT_SCHEMA_VERSION } from '@server/ripmail/schema.js'
import {
  ripmailAttachmentList,
  ripmailReadMail,
  ripmailSearch,
  ripmailStatus,
  ripmailWho,
} from '@server/ripmail/index.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..', '..')
const evalBrain = resolve(repoRoot, 'data', ENRON_DEMO_TENANT_USER_ID_DEFAULT)
const ripmailHome = join(evalBrain, 'ripmail')
const ripmailDb = join(ripmailHome, 'ripmail.db')

const JANET_WEEKLY_REPORT_ID = '2322798.1075855417584.JavaMail.evans@thyme'

/** Read SQLite `user_version` without invoking `prepareRipmailDb` / rebuild paths. */
function readRipmailUserVersionFast(dbPath: string): number | null {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      return db.pragma('user_version', { simple: true }) as number
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

function isCorpusReady(): Promise<boolean> {
  if (!existsSync(ripmailDb)) return Promise.resolve(false)
  const uv = readRipmailUserVersionFast(ripmailDb)
  if (uv !== CURRENT_SCHEMA_VERSION) return Promise.resolve(false)
  try {
    if (statSync(ripmailDb).size < 10_000) return Promise.resolve(false)
  } catch {
    return Promise.resolve(false)
  }
  return ripmailStatus(ripmailHome)
    .then((s) => s.indexedMessages >= 1_000)
    .catch(() => false)
}

describe('Enron corpus (TS ripmail)', () => {
  let corpusReady = false

  beforeAll(async () => {
    corpusReady = await isCorpusReady()
  })

  it('search: Weekly Report from janet returns hits', async (ctx) => {
    if (!corpusReady) return ctx.skip()
    const tsResult = await ripmailSearch(ripmailHome, {
      query: 'Weekly Report',
      from: 'janet.butler@enron.com',
      afterDate: '2001-11-01',
      beforeDate: '2002-01-15',
      limit: 5,
      includeAll: true,
    })
    expect(tsResult.results.length).toBeGreaterThan(0)
    expect(tsResult.totalMatched).toBeGreaterThan(0)
  })

  it('readMail: known message id', async (ctx) => {
    if (!corpusReady) return ctx.skip()
    const tsResult = await ripmailReadMail(ripmailHome, JANET_WEEKLY_REPORT_ID, { includeAttachments: false })
    expect(tsResult).not.toBeNull()
    expect(tsResult!.messageId).toBe(JANET_WEEKLY_REPORT_ID)
    expect(tsResult!.fromAddress.toLowerCase()).toContain('janet')
    expect(tsResult!.subject).toBeTruthy()
  })

  it('who: kean returns contacts', async (ctx) => {
    if (!corpusReady) return ctx.skip()
    const tsResult = await ripmailWho(ripmailHome, 'kean', { limit: 20 })
    expect(tsResult.contacts.length).toBeGreaterThan(0)
  })

  it('attachmentList: known message', async (ctx) => {
    if (!corpusReady) return ctx.skip()
    const tsResult = await ripmailAttachmentList(ripmailHome, JANET_WEEKLY_REPORT_ID)
    expect(Array.isArray(tsResult)).toBe(true)
  })

  it('status: indexedMessages > 0', async (ctx) => {
    if (!corpusReady) return ctx.skip()
    expect((await ripmailStatus(ripmailHome)).indexedMessages).toBeGreaterThan(0)
  })

  it('search: broad pattern', async (ctx) => {
    if (!corpusReady) return ctx.skip()
    const result = await ripmailSearch(ripmailHome, {
      query: 'Enron',
      limit: 10,
      includeAll: true,
    })
    expect(result.results.length).toBeGreaterThan(0)
  })

  it('search: from filter only', async (ctx) => {
    if (!corpusReady) return ctx.skip()
    const result = await ripmailSearch(ripmailHome, {
      from: 'enron.com',
      limit: 10,
      includeAll: true,
    })
    expect(result.results.length).toBeGreaterThan(0)
  })

  it('readMail: rawPath populated', async (ctx) => {
    if (!corpusReady) return ctx.skip()
    const result = await ripmailReadMail(ripmailHome, JANET_WEEKLY_REPORT_ID)
    expect(result).not.toBeNull()
    expect(result!.rawPath).toBeTruthy()
  })
})
