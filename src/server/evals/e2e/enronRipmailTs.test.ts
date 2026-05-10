/**
 * Enron corpus E2E for the TypeScript ripmail module (`./data` Kean demo tenant).
 *
 * Skips when the Enron corpus is not seeded. Seed: `npm run brain:seed-enron-demo`
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENRON_DEMO_TENANT_USER_ID_DEFAULT } from '@server/lib/auth/enronDemo.js'
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

function isCorpusReady(): boolean {
  if (!existsSync(ripmailDb)) return false
  try {
    if (statSync(ripmailDb).size < 10_000) return false
  } catch {
    return false
  }
  try {
    const n = ripmailStatus(ripmailHome).indexedMessages
    return n >= 1_000
  } catch {
    return false
  }
}

describe('Enron corpus (TS ripmail)', () => {
  let corpusReady = false

  beforeAll(() => {
    corpusReady = isCorpusReady()
  })

  it('search: Weekly Report from janet returns hits', (ctx) => {
    if (!corpusReady) return ctx.skip()
    const tsResult = ripmailSearch(ripmailHome, {
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

  it('readMail: known message id', (ctx) => {
    if (!corpusReady) return ctx.skip()
    const tsResult = ripmailReadMail(ripmailHome, JANET_WEEKLY_REPORT_ID, { includeAttachments: false })
    expect(tsResult).not.toBeNull()
    expect(tsResult!.messageId).toBe(JANET_WEEKLY_REPORT_ID)
    expect(tsResult!.fromAddress.toLowerCase()).toContain('janet')
    expect(tsResult!.subject).toBeTruthy()
  })

  it('who: kean returns contacts', (ctx) => {
    if (!corpusReady) return ctx.skip()
    const tsResult = ripmailWho(ripmailHome, 'kean', { limit: 20 })
    expect(tsResult.contacts.length).toBeGreaterThan(0)
  })

  it('attachmentList: known message', (ctx) => {
    if (!corpusReady) return ctx.skip()
    const tsResult = ripmailAttachmentList(ripmailHome, JANET_WEEKLY_REPORT_ID)
    expect(Array.isArray(tsResult)).toBe(true)
  })

  it('status: indexedMessages > 0', (ctx) => {
    if (!corpusReady) return ctx.skip()
    expect(ripmailStatus(ripmailHome).indexedMessages).toBeGreaterThan(0)
  })

  it('search: broad pattern', (ctx) => {
    if (!corpusReady) return ctx.skip()
    const result = ripmailSearch(ripmailHome, {
      query: 'Enron',
      limit: 10,
      includeAll: true,
    })
    expect(result.results.length).toBeGreaterThan(0)
  })

  it('search: from filter only', (ctx) => {
    if (!corpusReady) return ctx.skip()
    const result = ripmailSearch(ripmailHome, {
      from: 'enron.com',
      limit: 10,
      includeAll: true,
    })
    expect(result.results.length).toBeGreaterThan(0)
  })

  it('readMail: rawPath populated', (ctx) => {
    if (!corpusReady) return ctx.skip()
    const result = ripmailReadMail(ripmailHome, JANET_WEEKLY_REPORT_ID)
    expect(result).not.toBeNull()
    expect(result!.rawPath).toBeTruthy()
  })
})
