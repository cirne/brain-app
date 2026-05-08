import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeBrainGlobalDbForTests } from '@server/lib/global/brainGlobalDb.js'
import {
  createBrainQueryGrant,
} from './brainQueryGrantsRepo.js'
import { getBrainQueryLogById } from './brainQueryLogRepo.js'
import { POLICY_ALWAYS_OMIT } from '@shared/brainQueryAnswerBaseline.js'
import {
  buildBrainQueryFilterSystemPrompt,
  buildBrainQueryResearchSystemPrompt,
  parsePrivacyFilterJson,
  runBrainQuery,
  type BrainQueryAgentPort,
} from './runBrainQuery.js'

describe('buildBrainQueryResearchSystemPrompt', () => {
  it('includes baseline omit rules and untrusted-question framing', () => {
    const p = buildBrainQueryResearchSystemPrompt('America/Los_Angeles')
    expect(p).toContain(POLICY_ALWAYS_OMIT)
    expect(p).toMatch(/UNTRUSTED USER-LEVEL INPUT/)
    expect(p).toMatch(/MFA|one-time/i)
    expect(p).toMatch(/national ID|Social Security/i)
  })
})

describe('buildBrainQueryFilterSystemPrompt', () => {
  it('layers baseline then owner policy', () => {
    const owner = 'Onlysay hello.'
    const s = buildBrainQueryFilterSystemPrompt(owner)
    expect(s.indexOf(POLICY_ALWAYS_OMIT)).toBeLessThan(s.indexOf(owner))
    expect(s).toContain('OWNER PRIVACY POLICY')
    expect(s).toContain(owner)
  })
})

describe('parsePrivacyFilterJson', () => {
  it('parses minimal JSON object from model output', () => {
    const p = parsePrivacyFilterJson('{"filtered_answer":"Hello","blocked":false}')
    expect(p?.filtered_answer).toBe('Hello')
    expect(p?.blocked).toBe(false)
  })

  it('extracts object from surrounding text', () => {
    const p = parsePrivacyFilterJson('Here: {"filtered_answer":"x","blocked":true,"reason":"nope"}')
    expect(p?.blocked).toBe(true)
  })
})

describe('runBrainQuery', () => {
  let tmp: string
  let dbPath: string
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevGlobal = process.env.BRAIN_GLOBAL_SQLITE_PATH

  const ownerId = 'usr_oooooooooooooooooooo'
  const askerId = 'usr_aaaaaaaaaaaaaaaaaaaa'

  beforeEach(async () => {
    const dir = join(tmpdir(), `bqr-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    tmp = dir
    dbPath = join(tmp, 'brain-global.sqlite')
    process.env.BRAIN_DATA_ROOT = tmp
    process.env.BRAIN_GLOBAL_SQLITE_PATH = dbPath
    closeBrainGlobalDbForTests()
    await mkdir(join(tmp, ownerId), { recursive: true })
    await mkdir(join(tmp, askerId), { recursive: true })
  })

  afterEach(async () => {
    closeBrainGlobalDbForTests()
    if (prevRoot !== undefined) process.env.BRAIN_DATA_ROOT = prevRoot
    else delete process.env.BRAIN_DATA_ROOT
    if (prevGlobal !== undefined) process.env.BRAIN_GLOBAL_SQLITE_PATH = prevGlobal
    else delete process.env.BRAIN_GLOBAL_SQLITE_PATH
    await rm(tmp, { recursive: true, force: true })
  })

  it('denied_no_grant when no ACL row', async () => {
    const out = await runBrainQuery({
      ownerId,
      askerId,
      question: 'What is up?',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.code).toBe('denied_no_grant')
    }
    const log = getBrainQueryLogById(out.logId)
    expect(log?.status).toBe('denied_no_grant')
  })

  it('happy path with injected agent port', async () => {
    createBrainQueryGrant({
      ownerId,
      askerId,
      privacyPolicy: 'No secrets.',
    })
    const port: BrainQueryAgentPort = {
      runResearch: async () => ({ text: 'The invoice was $47,500 for concrete work.' }),
      runFilter: async () => ({
        text: JSON.stringify({
          filtered_answer: 'The invoice was a substantial five-figure amount for concrete work.',
          blocked: false,
          redactions: ['exact dollar amount'],
        }),
      }),
    }
    const out = await runBrainQuery({
      ownerId,
      askerId,
      question: 'construction billing?',
      agentPort: port,
    })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.answer).toContain('five-figure')
    }
    const log = getBrainQueryLogById(out.logId)
    expect(log?.status).toBe('ok')
    expect(log?.draft_answer).toContain('47,500')
  })

  it('filter_blocked when blocked true', async () => {
    createBrainQueryGrant({
      ownerId,
      askerId,
    })
    const port: BrainQueryAgentPort = {
      runResearch: async () => ({ text: 'too sensitive' }),
      runFilter: async () =>
        Promise.resolve({
          text: JSON.stringify({
            filtered_answer: 'I cannot answer that.',
            blocked: true,
            reason: 'health',
          }),
        }),
    }
    const out = await runBrainQuery({
      ownerId,
      askerId,
      question: 'x',
      agentPort: port,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('filter_blocked')
    const log = getBrainQueryLogById(out.logId)
    expect(log?.status).toBe('filter_blocked')
    expect(log?.final_answer).toContain('cannot')
  })
})
