import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadB2BV1TasksFromFile } from '@server/evals/harness/loadJsonlEvalTasks.js'
import { getEvalRepoRoot } from '@server/evals/harness/runLlmJsonlEval.js'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { createAgentTools } from './tools.js'
import { B2B_QUERY_ONLY } from './agentToolSets.js'
import {
  buildB2BFilterPrompt,
  buildB2BResearchPrompt,
  createB2BToolOptions,
  createB2BPreflightAgent,
  parsePreflightExpectsResponse,
} from './b2bAgent.js'
import { getFastBrainLlm, resetBrainLlmCanonicalCacheForTest } from '@server/lib/llm/effectiveBrainLlm.js'
import { resolveModel } from '@server/lib/llm/resolveModel.js'
import { loadB2BPreflightTasksFromFile } from '@server/evals/harness/loadJsonlEvalTasks.js'

ensurePromptsRoot(fileURLToPath(new URL('../prompts', import.meta.url)))

function toolNamesForB2B(wikiRoot: string): string[] {
  return createAgentTools(wikiRoot, createB2BToolOptions('America/Chicago'))
    .map(t => (t as { name?: string }).name)
    .filter((name): name is string => typeof name === 'string')
}

describe('b2bAgent', () => {
  it('uses a restricted read-only tool allowlist', async () => {
    const wikiRoot = await mkdtemp(join(tmpdir(), 'b2b-agent-tools-'))
    try {
      const names = toolNamesForB2B(wikiRoot)
      expect(names).toEqual(expect.arrayContaining([...B2B_QUERY_ONLY]))
      expect(names).not.toEqual(expect.arrayContaining(['write', 'edit', 'draft_email', 'send_draft', 'ask_collaborator']))
    } finally {
      await rm(wikiRoot, { recursive: true, force: true })
    }
  })

  it('builds a research prompt with owner profile and grant policy', async () => {
    const wikiRoot = await mkdtemp(join(tmpdir(), 'b2b-agent-prompt-'))
    try {
      await writeFile(join(wikiRoot, 'me.md'), 'Ken Lay prefers concise leadership updates.\n', 'utf-8')
      const prompt = buildB2BResearchPrompt({
        ownerDisplayName: 'Kenneth Lay',
        privacyPolicy: 'Do not reveal financial details.',
        wikiRoot,
        timezone: 'America/Chicago',
        promptClock: { tenantUserId: null },
      })
      expect(prompt).toContain('Kenneth Lay')
      expect(prompt).toContain('Do not reveal financial details.')
      expect(prompt).toContain('Ken Lay prefers concise leadership updates.')
      expect(prompt).toContain('Do not expose tool calls')
      expect(prompt).toContain('Single outbound message')
      expect(prompt).toContain('No assistant rituals')
    } finally {
      await rm(wikiRoot, { recursive: true, force: true })
    }
  })

  it('builds a filter prompt around the policy and draft answer', () => {
    const prompt = buildB2BFilterPrompt({
      privacyPolicy: 'No message ids.',
      draftAnswer: 'Here is JavaMail.evans@thyme from a tool result.',
    })
    expect(prompt).toContain('No message ids.')
    expect(prompt).toContain('JavaMail.evans@thyme')
    expect(prompt).toContain('Filtering rules')
    expect(prompt).toContain('Strip assistant fluff')
  })

  it('b2b-v1.jsonl tasks include anti-assistant finalText guardrails', async () => {
    const tasks = await loadB2BV1TasksFromFile(join(getEvalRepoRoot(), 'eval/tasks/b2b-v1.jsonl'))
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks.every(t => JSON.stringify(t.expect).includes('let me know'))).toBe(true)
  })

  it('preflight agent model matches fast tier (BRAIN_FAST_LLM or BRAIN_LLM fallback)', () => {
    const prevLlm = process.env.BRAIN_LLM
    const prevFast = process.env.BRAIN_FAST_LLM
    try {
      process.env.BRAIN_LLM = 'openai/gpt-5.4'
      process.env.BRAIN_FAST_LLM = 'openai/gpt-5.4-nano'
      resetBrainLlmCanonicalCacheForTest()
      const pair = getFastBrainLlm()
      const want = resolveModel(pair.provider, pair.modelId)
      expect(want).toBeDefined()
      const got = createB2BPreflightAgent('ping').state.model
      expect(got.id).toBe(want!.id)

      delete process.env.BRAIN_FAST_LLM
      resetBrainLlmCanonicalCacheForTest()
      const pair2 = getFastBrainLlm()
      const want2 = resolveModel(pair2.provider, pair2.modelId)
      expect(want2).toBeDefined()
      const got2 = createB2BPreflightAgent('ping').state.model
      expect(got2.id).toBe(want2!.id)
      expect(pair2.modelId).toBe('gpt-5.4')
    } finally {
      if (prevLlm === undefined) delete process.env.BRAIN_LLM
      else process.env.BRAIN_LLM = prevLlm
      if (prevFast === undefined) delete process.env.BRAIN_FAST_LLM
      else process.env.BRAIN_FAST_LLM = prevFast
      resetBrainLlmCanonicalCacheForTest()
    }
  })

  it('parsePreflightExpectsResponse accepts bare JSON and embedded JSON', () => {
    expect(parsePreflightExpectsResponse('{"expectsResponse":false}')).toBe(false)
    expect(parsePreflightExpectsResponse('{"expectsResponse":true}')).toBe(true)
    expect(parsePreflightExpectsResponse('prefix {"expectsResponse":false} suffix')).toBe(false)
    expect(parsePreflightExpectsResponse('')).toBe(null)
    expect(parsePreflightExpectsResponse('not json')).toBe(null)
  })

  it('b2b-preflight.jsonl loads with id + message + expectsResponse', async () => {
    const tasks = await loadB2BPreflightTasksFromFile(join(getEvalRepoRoot(), 'eval/tasks/b2b-preflight.jsonl'))
    expect(tasks.length).toBeGreaterThan(0)
    for (const t of tasks) {
      expect(typeof t.id).toBe('string')
      expect(typeof t.message).toBe('string')
      expect(typeof t.expectsResponse).toBe('boolean')
    }
  })
})
