import type { Agent, AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core'
import {
  countAssistantCompletionsWithUsage,
  sumUsageFromMessages,
  type LlmUsageSnapshot,
} from '../../lib/llmUsage.js'
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

/**
 * One `agent.prompt()`: subscribe for tool results + `agent_end`, then aggregate usage
 * (same pattern as chat SSE and wiki invocations).
 */
export async function collectAgentPromptMetrics(agent: Agent, message: string): Promise<CollectedAgentPromptMetrics> {
  const toolNames: string[] = []
  const toolTextParts: string[] = []
  let endMessages: AgentMessage[] = []

  await agent.waitForIdle()
  const t0 = performance.now()
  const unsubscribe = agent.subscribe(async (ev: AgentEvent) => {
    try {
      if (ev.type === 'tool_execution_start' && 'toolName' in ev) {
        toolNames.push((ev as { toolName: string }).toolName)
      }
      if (ev.type === 'tool_execution_end') {
        const txt = toolResultTextFromAgentEvent(ev)
        if (txt.length > 0) toolTextParts.push(txt)
      }
      if (ev.type === 'agent_end' && 'messages' in ev) {
        endMessages = (ev as { messages: AgentMessage[] }).messages
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
