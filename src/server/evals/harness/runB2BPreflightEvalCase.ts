import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import {
  B2B_PREFLIGHT_USER_TURN,
  createB2BPreflightAgent,
  parsePreflightExpectsResponse,
} from '@server/agent/b2bAgent.js'
import { collectAgentPromptMetrics } from './collectAgentPromptMetrics.js'
import type { B2BPreflightTask } from './types.js'
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
 * One preflight LLM call (optional **`BRAIN_FAST_LLM`**, else **`BRAIN_LLM`**) + JSON parse; pass when `expectsResponse` matches task label.
 * Mirrors {@link runB2BPreflight} semantics (including default `true` on parse failure).
 */
export async function runB2BPreflightEvalCase(task: B2BPreflightTask): Promise<RunAgentEvalCaseResult> {
  const trimmed = task.message.trim()
  if (!trimmed) {
    const got = true
    const ok = got === task.expectsResponse
    return {
      id: task.id,
      ok,
      failReasons: ok ? [] : [`empty message: expected expectsResponse=${task.expectsResponse} got ${got}`],
      wallMs: 0,
      usage: ZERO,
      completionCount: 0,
      finalText: JSON.stringify({ expectsResponse: got, rawAssistant: '' }),
      toolNames: [],
      toolTextConcat: '',
    }
  }

  const prevSuggestRepair = process.env.BRAIN_SUGGEST_REPLY_REPAIR
  process.env.BRAIN_SUGGEST_REPLY_REPAIR = '0'
  try {
    const agent = createB2BPreflightAgent(trimmed)
    const m = await collectAgentPromptMetrics(agent, B2B_PREFLIGHT_USER_TURN, {
      evalTraceCaseId: task.id,
      diagnosticsAgentKind: 'b2b_preflight_eval',
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
        finalText: m.finalText,
        toolNames: m.toolNames,
        toolTextConcat: m.toolTextConcat,
        model: m.model,
        provider: m.provider,
      }
    }

    const parsed = parsePreflightExpectsResponse(m.finalText)
    const got = parsed ?? true
    const ok = got === task.expectsResponse
    const failReasons: string[] = []
    if (!ok) {
      failReasons.push(
        `expected expectsResponse=${task.expectsResponse} got ${got}` +
          (parsed === null ? ' (parse failed; product defaults to true)' : ''),
      )
    }

    return {
      id: task.id,
      ok,
      failReasons,
      wallMs: m.wallMs,
      usage: m.usage,
      completionCount: m.completionCount,
      finalText: JSON.stringify({ expectsResponse: got, rawAssistant: m.finalText }),
      toolNames: m.toolNames,
      toolTextConcat: m.toolTextConcat,
      model: m.model,
      provider: m.provider,
    }
  } finally {
    if (prevSuggestRepair === undefined) delete process.env.BRAIN_SUGGEST_REPLY_REPAIR
    else process.env.BRAIN_SUGGEST_REPLY_REPAIR = prevSuggestRepair
  }
}
