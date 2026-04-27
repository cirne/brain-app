import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { deleteSession, getOrCreateSession } from '../../agent/assistantAgent.js'

ensurePromptsRoot(fileURLToPath(new URL('../../prompts', import.meta.url)))
import { checkExpect } from './checkExpect.js'
import { collectAgentPromptMetrics } from './collectAgentPromptMetrics.js'
import type { LlmUsageSnapshot } from '@server/lib/llm/llmUsage.js'
import type { EnronV1Task } from './types.js'

export type RunAgentEvalCaseResult = {
  id: string
  ok: boolean
  error?: string
  failReasons: string[]
  wallMs: number
  usage: LlmUsageSnapshot
  completionCount: number
  finalText: string
  toolNames: string[]
  /** All tool result bodies concatenated (for expectations / debugging). */
  toolTextConcat: string
  model?: string
  provider?: string
}

/**
 * One `agent.prompt()` with an isolated in-memory session (new sessionId each call).
 * Aggregates `usage` from `agent_end` the same way as chat SSE and wiki invocations.
 */
export async function runAgentEvalCase(task: EnronV1Task, options: { timezone?: string } = {}): Promise<RunAgentEvalCaseResult> {
  const sessionId = randomUUID()
  const agent = await getOrCreateSession(sessionId, { timezone: options.timezone ?? 'America/Chicago' })
  const failReasons: string[] = []

  const m = await collectAgentPromptMetrics(agent, task.userMessage, {
    evalTraceCaseId: task.id,
  })
  deleteSession(sessionId)

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

  const check = checkExpect(task.expect, m.finalText, m.toolTextConcat, m.toolNames)
  if (!check.ok) {
    for (const r of check.reasons) failReasons.push(r)
  }

  return {
    id: task.id,
    ok: check.ok,
    failReasons,
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
