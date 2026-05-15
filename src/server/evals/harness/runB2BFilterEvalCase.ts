import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import {
  B2B_FILTER_USER_TURN,
  createB2BFilterAgent,
  finalizeB2BFilteredText,
} from '@server/agent/b2bAgent.js'
import { checkExpect } from './checkExpect.js'
import { collectAgentPromptMetrics } from './collectAgentPromptMetrics.js'
import type { B2BFilterEvalTask } from './types.js'
import type { RunAgentEvalCaseResult } from './runAgentEvalCase.js'
import type { LlmUsageSnapshot } from '@server/lib/llm/llmUsage.js'

ensurePromptsRoot(fileURLToPath(new URL('../../prompts', import.meta.url)))

const ZERO: LlmUsageSnapshot = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costTotal: 0,
}

/**
 * One `finalizeB2BFilteredText`-wrapped B2B filter LLM call (no research agent, no tools).
 * Matches the filter step in `filterB2BResponse` (prompt + user turn + empty fallback).
 */
export async function runB2BFilterEvalCase(task: B2BFilterEvalTask): Promise<RunAgentEvalCaseResult> {
  const prevSuggestRepair = process.env.BRAIN_SUGGEST_REPLY_REPAIR
  process.env.BRAIN_SUGGEST_REPLY_REPAIR = '0'
  try {
    const agent = createB2BFilterAgent(task.privacyPolicy, task.draftAnswer)
    const m = await collectAgentPromptMetrics(agent, B2B_FILTER_USER_TURN, {
      evalTraceCaseId: task.id,
      diagnosticsAgentKind: 'b2b_filter_eval',
    })
    if (m.error) {
      return {
        id: task.id,
        ok: false,
        error: m.error,
        failReasons: [m.error],
        wallMs: m.wallMs,
        usage: m.usage,
        completionCount: m.completionCount,
        finalText: '',
        toolNames: [],
        toolTextConcat: '',
        model: m.model,
        provider: m.provider,
      }
    }
    const finalText = finalizeB2BFilteredText(m.finalText)
    const check = await checkExpect(task.expect, finalText, '', [])
    return {
      id: task.id,
      ok: check.ok,
      failReasons: check.reasons,
      wallMs: m.wallMs,
      usage: m.usage,
      completionCount: m.completionCount,
      finalText,
      toolNames: [],
      toolTextConcat: '',
      model: m.model,
      provider: m.provider,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      id: task.id,
      ok: false,
      error: msg,
      failReasons: [msg],
      wallMs: 0,
      usage: ZERO,
      completionCount: 0,
      finalText: '',
      toolNames: [],
      toolTextConcat: '',
    }
  } finally {
    if (prevSuggestRepair === undefined) delete process.env.BRAIN_SUGGEST_REPLY_REPAIR
    else process.env.BRAIN_SUGGEST_REPLY_REPAIR = prevSuggestRepair
  }
}
