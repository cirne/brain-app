import type { Agent, AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core'
import {
  countAssistantCompletionsWithUsage,
  sumUsageFromMessages,
  type LlmUsageSnapshot,
} from '@server/lib/llm/llmUsage.js'
import { lastAssistantTextFromMessages, toolResultTextFromAgentEvent } from './extractTranscript.js'

export type CollectedAgentPromptMetrics = {
  wallMs: number
  usage: LlmUsageSnapshot
  completionCount: number
  finalText: string
  toolNames: string[]
  toolTextConcat: string
  model?: string
  provider?: string
  endMessages: AgentMessage[]
  error?: string
}

export type CollectAgentPromptMetricsOptions = {
  timezone?: string
  /** When `EVAL_AGENT_TRACE=1`, logs `[eval:agent]` JSON lines for this case (LLM turns vs tools). */
  evalTraceCaseId?: string
}

/**
 * One `agent.prompt()`: subscribe for tool results + `agent_end`, then aggregate usage
 * (same pattern as chat SSE and wiki invocations).
 */
export async function collectAgentPromptMetrics(
  agent: Agent,
  message: string,
  options: CollectAgentPromptMetricsOptions = {},
): Promise<CollectedAgentPromptMetrics> {
  const toolNames: string[] = []
  const toolTextParts: string[] = []
  let endMessages: AgentMessage[] = []

  await agent.waitForIdle()
  const t0 = performance.now()
  const traceCaseId =
    process.env.EVAL_AGENT_TRACE === '1' && options.evalTraceCaseId?.trim()
      ? options.evalTraceCaseId.trim()
      : undefined
  const agentTrace = (event: string, extra?: Record<string, unknown>) => {
    if (!traceCaseId) return
    console.log(
      JSON.stringify({
        tag: '[eval:agent]',
        caseId: traceCaseId,
        event,
        elapsedMs: Math.round(performance.now() - t0),
        ...extra,
      }),
    )
  }

  const unsubscribe = agent.subscribe(async (ev: AgentEvent) => {
    try {
      if (traceCaseId) {
        if (ev.type === 'agent_start') agentTrace('agent_start')
        if (ev.type === 'turn_start') agentTrace('turn_start', { note: 'LLM request (streaming / thinking)' })
        if (ev.type === 'turn_end') {
          const msg = ev.message as { stopReason?: string }
          agentTrace('turn_end', {
            stopReason: msg.stopReason,
            toolResultCount: ev.toolResults.length,
          })
        }
        if (ev.type === 'tool_execution_start') {
          agentTrace('tool_start', { tool: ev.toolName })
        }
        if (ev.type === 'tool_execution_end') {
          agentTrace('tool_end', { tool: ev.toolName, isError: ev.isError })
        }
      }
      if (ev.type === 'tool_execution_start' && 'toolName' in ev) {
        toolNames.push((ev as { toolName: string }).toolName)
      }
      if (ev.type === 'tool_execution_end') {
        const txt = toolResultTextFromAgentEvent(ev)
        if (txt.length > 0) toolTextParts.push(txt)
      }
      if (ev.type === 'agent_end' && 'messages' in ev) {
        endMessages = (ev as { messages: AgentMessage[] }).messages
        if (traceCaseId) agentTrace('agent_end')
      }
    } catch {
      /* best-effort */
    }
  })

  let err: string | undefined
  try {
    await agent.prompt(message)
  } catch (e) {
    err = e instanceof Error ? e.message : String(e)
  } finally {
    unsubscribe()
  }

  const wallMs = performance.now() - t0
  const toolTextConcat = toolTextParts.join('\n\n')
  const finalText = lastAssistantTextFromMessages(endMessages)
  const usage = sumUsageFromMessages(endMessages)
  const completionCount = countAssistantCompletionsWithUsage(endMessages)
  const labels = modelLabelFromTranscript(endMessages)
  if (err) {
    return {
      wallMs,
      usage,
      completionCount,
      finalText,
      toolNames,
      toolTextConcat,
      endMessages,
      model: labels.model,
      provider: labels.provider,
      error: err,
    }
  }
  return {
    wallMs,
    usage,
    completionCount,
    finalText,
    toolNames,
    toolTextConcat,
    endMessages,
    model: labels.model,
    provider: labels.provider,
  }
}

function modelLabelFromTranscript(messages: AgentMessage[]): { model?: string; provider?: string } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && typeof m === 'object' && 'role' in m && m.role === 'assistant' && 'model' in m) {
      return {
        model: String((m as { model?: string }).model ?? ''),
        provider: String((m as { provider?: string }).provider ?? ''),
      }
    }
  }
  return {}
}
