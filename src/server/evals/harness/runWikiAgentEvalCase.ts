import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { getOrCreateWikiBuildoutAgent, deleteWikiBuildoutSession } from '../../agent/wikiBuildoutAgent.js'
import { getOrCreateWikiExecuteAgent, deleteWikiExecuteSession } from '../../agent/wikiExecuteAgent.js'
import { getOrCreateWikiSurveyAgent, deleteWikiSurveySession } from '../../agent/wikiSurveyAgent.js'
import { createCleanupAgent } from '../../agent/agentFactory.js'
import { buildExpansionContextPrefix, buildCleanupSystemPrompt, buildSurveyContextPrefix } from '../../agent/wikiExpansionRunner.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import type { LlmUsageSnapshot } from '@server/lib/llm/llmUsage.js'
import {
  formatPlanForExecutePrompt,
  normalizeWikiLapPlan,
  validateAndSanitizeWikiLapPlan,
  writeAllowlistFromPlan,
} from '../../lib/wiki/wikiLapPlan.js'
import { checkExpect } from './checkExpect.js'
import { collectAgentPromptMetrics, type CollectedAgentPromptMetrics } from './collectAgentPromptMetrics.js'
import type { RunAgentEvalCaseResult } from './runAgentEvalCase.js'
import type { WikiV1Task } from './types.js'

ensurePromptsRoot(fileURLToPath(new URL('../../prompts', import.meta.url)))

const ZERO_USAGE: LlmUsageSnapshot = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costTotal: 0,
}

function wikiHarnessSetupFailure(task: WikiV1Task, message: string): RunAgentEvalCaseResult {
  return {
    id: task.id,
    ok: false,
    error: message,
    failReasons: [message],
    wallMs: 0,
    usage: ZERO_USAGE,
    completionCount: 0,
    finalText: '',
    toolNames: [],
    toolTextConcat: '',
  }
}

/**
 * One wiki **execute** (`buildout` or `execute` in JSONL), **survey**, or **cleanup** (lint) `agent.prompt()`, same tools/models as Your Wiki.
 */
export async function runWikiAgentEvalCase(
  task: WikiV1Task,
  options: { timezone?: string } = {},
): Promise<RunAgentEvalCaseResult> {
  const tz = options.timezone ?? 'America/Chicago'
  const w = wikiDir()
  const failReasons: string[] = []

  if (task.agent === 'survey') {
    const prefix = await buildSurveyContextPrefix(w, { lap: 1 })
    const sessionId = `eval-wiki-survey-${randomUUID()}`
    const agent = await getOrCreateWikiSurveyAgent(sessionId, { timezone: tz })
    const fullMessage = `${prefix}${task.userMessage}`
    const m = await collectAgentPromptMetrics(agent, fullMessage, { evalTraceCaseId: task.id })
    deleteWikiSurveySession(sessionId)
    return await finishWikiCase(task, m, failReasons)
  }

  const prefix = await buildExpansionContextPrefix(w)

  if (task.agent === 'buildout' || task.agent === 'execute') {
    if (task.executePlan != null) {
      const normalized = normalizeWikiLapPlan(task.executePlan)
      if (!normalized) {
        return wikiHarnessSetupFailure(task, 'invalid executePlan: normalize failed')
      }
      const validation = validateAndSanitizeWikiLapPlan(normalized)
      if (!validation.ok) {
        return wikiHarnessSetupFailure(task, validation.error)
      }
      const plan = validation.plan
      if (plan.idle) {
        return wikiHarnessSetupFailure(task, 'executePlan is idle after validation (no actionable work)')
      }
      const allow = writeAllowlistFromPlan(plan)
      const sessionId = `eval-wiki-ex-${randomUUID()}`
      const agent = await getOrCreateWikiExecuteAgent(sessionId, {
        timezone: tz,
        wikiWriteAllowlist: [...allow],
        isFirstBuildoutRun: true,
      })
      const planBlock = formatPlanForExecutePrompt(plan)
      const fullMessage = prefix
        ? `${prefix}${planBlock}\n\n---\n\n${task.userMessage}`
        : `${planBlock}\n\n---\n\n${task.userMessage}`
      try {
        const m = await collectAgentPromptMetrics(agent, fullMessage, { evalTraceCaseId: task.id })
        return await finishWikiCase(task, m, failReasons)
      } finally {
        deleteWikiExecuteSession(sessionId)
      }
    }

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
