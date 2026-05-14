import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { getOrCreateWikiBuildoutAgent, deleteWikiBuildoutSession } from '../../agent/wikiBuildoutAgent.js'

ensurePromptsRoot(fileURLToPath(new URL('../../prompts', import.meta.url)))
import { createCleanupAgent } from '../../agent/agentFactory.js'
import { buildExpansionContextPrefix, buildCleanupSystemPrompt } from '../../agent/wikiExpansionRunner.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { checkExpect } from './checkExpect.js'
import { collectAgentPromptMetrics, type CollectedAgentPromptMetrics } from './collectAgentPromptMetrics.js'
import type { RunAgentEvalCaseResult } from './runAgentEvalCase.js'
import type { WikiV1Task } from './types.js'

/**
 * One wiki **buildout** (enrich) or **cleanup** (lint) `agent.prompt()`, same tools/models as Your Wiki.
 */
export async function runWikiAgentEvalCase(
  task: WikiV1Task,
  options: { timezone?: string } = {},
): Promise<RunAgentEvalCaseResult> {
  const tz = options.timezone ?? 'America/Chicago'
  const w = wikiDir()
  const failReasons: string[] = []
  const prefix = await buildExpansionContextPrefix(w)

  if (task.agent === 'buildout') {
    const sessionId = `eval-wiki-bo-${randomUUID()}`
    const agent = await getOrCreateWikiBuildoutAgent(sessionId, { timezone: tz })
    const fullMessage = prefix
      ? `${prefix}${task.userMessage}`
      : task.userMessage
    const m = await collectAgentPromptMetrics(agent, fullMessage, { evalTraceCaseId: task.id })
    deleteWikiBuildoutSession(sessionId)
    return await finishWikiCase(task, m, failReasons)
  }

  const systemPrompt = buildCleanupSystemPrompt(tz)
  const agent = createCleanupAgent(systemPrompt, w)
  const fullMessage = prefix
    ? `${prefix}${task.userMessage}`
    : task.userMessage
  const m = await collectAgentPromptMetrics(agent, fullMessage, { evalTraceCaseId: task.id })
  return await finishWikiCase(task, m, failReasons)
}

async function finishWikiCase(
  task: WikiV1Task,
  m: CollectedAgentPromptMetrics,
  failReasons: string[],
): Promise<RunAgentEvalCaseResult> {
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
  const check = await checkExpect(task.expect, m.finalText, m.toolTextConcat, m.toolNames)
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
