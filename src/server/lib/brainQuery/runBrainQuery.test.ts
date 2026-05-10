import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { ToolResultMessage } from '@mariozechner/pi-ai'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { REJECT_QUESTION_TOOL_NAME } from '@shared/brainQueryReject.js'
import { listNotifications } from '@server/lib/notifications/notificationsRepo.js'
import { ensureTenantHomeDir, tenantHomeDir } from '@server/lib/tenant/dataRoot.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { closeTenantDbForTests } from '@server/lib/tenant/tenantSqlite.js'
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
  previewBrainQueryPrivacyFilter,
  runBrainQuery,
  type BrainQueryAgentPort,
} from './runBrainQuery.js'

describe('buildBrainQueryResearchSystemPrompt', () => {
  it('includes baseline omit rules and untrusted-question framing', () => {
    const p = buildBrainQueryResearchSystemPrompt('America/Los_Angeles', 'Only share logistics.')
    expect(p).toContain(POLICY_ALWAYS_OMIT)
    expect(p).toContain('Only share logistics.')
    expect(p).toMatch(/UNTRUSTED USER-LEVEL INPUT/)
    expect(p).toMatch(/reject_question/)
    expect(p).toMatch(/MFA|one-time/i)
    expect(p).toMatch(/national ID|Social Security/i)
  })

  it('defaults to search before reject and names topical trip-sheet style asks as allowed', () => {
    const p = buildBrainQueryResearchSystemPrompt('UTC', 'Share trip logistics.')
    expect(p).toMatch(/DEFAULT: Use research tools/)
    expect(p).toContain('trip sheet for the July summer trip')
    expect(p).toMatch(/unfocused bulk export/)
    expect(p).not.toMatch(/Only use research tools when you have a specific/)
  })

  it('instructs wiki grep/find for travel alongside search_index and calendar', () => {
    const p = buildBrainQueryResearchSystemPrompt('UTC', 'Share logistics.')
    expect(p).toContain('Wiki vs indexed mail')
    expect(p).toContain('travel/')
    expect(p).toMatch(/search_index/)
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
    closeTenantDbForTests()
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
    closeTenantDbForTests()
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

    const ownerNotifs = await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: ownerId, homeDir: tenantHomeDir(ownerId) },
      async () => listNotifications({}),
    )
    expect(ownerNotifs).toHaveLength(0)
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

    const ownerNotifs = await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: ownerId, homeDir: ensureTenantHomeDir(ownerId) },
      async () => listNotifications({}),
    )
    expect(ownerNotifs).toHaveLength(1)
    expect(ownerNotifs[0].sourceKind).toBe('brain_query_inbound')
    expect(ownerNotifs[0].idempotencyKey).toBe(`brain_query_inbound:${out.logId}`)
    const pl = ownerNotifs[0].payload as Record<string, unknown>
    expect(pl.status).toBe('ok')
    expect(pl.deliveryMode).toBe('auto_sent')
    expect(pl.questionPreview).toBe('construction billing?')
    expect(pl.askerId).toBe(askerId)
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

    const ownerNotifs = await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: ownerId, homeDir: ensureTenantHomeDir(ownerId) },
      async () => listNotifications({}),
    )
    expect(ownerNotifs).toHaveLength(1)
    expect((ownerNotifs[0].payload as { status?: string }).status).toBe('filter_blocked')
  })

  it('early_rejected when research transcript contains reject_question result', async () => {
    createBrainQueryGrant({
      ownerId,
      askerId,
      privacyPolicy: 'Be conservative.',
    })
    const tr: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'call_er_1',
      toolName: REJECT_QUESTION_TOOL_NAME,
      content: [{ type: 'text', text: 'Too broad.' }],
      details: {
        rejected: true,
        reason: 'overly_broad',
        explanation:
          'That question is too open-ended to answer here—try asking something specific with a topic or date range.',
      },
      isError: false,
      timestamp: Date.now(),
    }
    const runFilter = vi.fn(async () => ({
      text: JSON.stringify({ filtered_answer: 'should not run', blocked: false }),
    }))
    const port: BrainQueryAgentPort = {
      runResearch: async () => ({
        text: '',
        messages: [tr as AgentMessage],
      }),
      runFilter,
    }
    const out = await runBrainQuery({
      ownerId,
      askerId,
      question: 'what is in my inbox?',
      agentPort: port,
    })
    expect(runFilter).not.toHaveBeenCalled()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.code).toBe('early_rejected')
    if (!out.ok) expect(out.message).toContain('open-ended')
    const log = getBrainQueryLogById(out.logId)
    expect(log?.status).toBe('early_rejected')
    expect(log?.final_answer).toContain('open-ended')
    expect(log?.filter_notes).toContain('early_rejection')

    const ownerNotifs = await runWithTenantContextAsync(
      { tenantUserId: ownerId, workspaceHandle: ownerId, homeDir: ensureTenantHomeDir(ownerId) },
      async () => listNotifications({}),
    )
    expect(ownerNotifs).toHaveLength(1)
    expect((ownerNotifs[0].payload as { status?: string }).status).toBe('early_rejected')
  })
})

describe('previewBrainQueryPrivacyFilter', () => {
  it('returns ok with redaction notes when filter allows', async () => {
    const out = await previewBrainQueryPrivacyFilter(
      {
        question: 'What is the amount?',
        draftAnswer: 'The total was $500.',
        privacyPolicy: 'Do not share exact amounts.',
      },
      {
        runFilter: async () => ({
          text: JSON.stringify({
            filtered_answer: 'The total was a few hundred dollars.',
            blocked: false,
            redactions: ['exact dollar amount'],
          }),
        }),
      },
    )
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.status).toBe('ok')
      expect(out.finalAnswer).toContain('hundred')
      expect(out.filterNotes).toContain('redactions')
    }
  })

  it('returns filter_blocked when model sets blocked', async () => {
    const out = await previewBrainQueryPrivacyFilter(
      { question: 'q', draftAnswer: 'x', privacyPolicy: 'no' },
      {
        runFilter: async () => ({
          text: JSON.stringify({
            filtered_answer: 'Cannot share.',
            blocked: true,
            reason: 'policy',
          }),
        }),
      },
    )
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.status).toBe('filter_blocked')
      expect(out.finalAnswer).toContain('Cannot')
    }
  })

  it('rejects empty draft', async () => {
    const out = await previewBrainQueryPrivacyFilter({
      question: 'q',
      draftAnswer: '   ',
      privacyPolicy: 'ok',
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toBe('draft_answer_required')
  })
})
