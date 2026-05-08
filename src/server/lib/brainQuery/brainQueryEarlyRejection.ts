import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, ToolResultMessage } from '@mariozechner/pi-ai'
import { REJECT_QUESTION_TOOL_NAME } from '@shared/brainQueryReject.js'
import type { RejectQuestionDetails, RejectQuestionReason } from './rejectQuestionTool.js'

export type EarlyRejectionExtract = {
  reason: RejectQuestionReason
  explanation: string
}

/** Models sometimes emit `too_broad`; the tool schema uses `overly_broad`. */
function normalizeRejectReason(raw: unknown): RejectQuestionReason {
  if (raw === 'too_broad') return 'overly_broad'
  if (
    raw === 'violates_baseline_policy' ||
    raw === 'violates_custom_policy' ||
    raw === 'overly_broad' ||
    raw === 'other'
  ) {
    return raw
  }
  return 'other'
}

function isToolResultMessage(m: AgentMessage): m is ToolResultMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    'role' in m &&
    (m as ToolResultMessage).role === 'toolResult' &&
    typeof (m as ToolResultMessage).toolName === 'string'
  )
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    'role' in m &&
    (m as AssistantMessage).role === 'assistant'
  )
}

function detailsFromToolResult(tr: ToolResultMessage): EarlyRejectionExtract | null {
  if (tr.toolName !== REJECT_QUESTION_TOOL_NAME) return null
  const det = tr.details as RejectQuestionDetails | undefined
  if (det?.rejected === true && typeof det.explanation === 'string') {
    const explanation = det.explanation.trim()
    if (!explanation) return null
    const reason = normalizeRejectReason(det.reason)
    return { reason, explanation }
  }
  return null
}

function fromAssistantToolCalls(m: AssistantMessage): EarlyRejectionExtract | null {
  if (!Array.isArray(m.content)) return null
  for (const c of m.content) {
    if (!c || typeof c !== 'object' || (c as { type?: string }).type !== 'toolCall') continue
    const tc = c as { type: 'toolCall'; name: string; arguments: Record<string, unknown> }
    if (tc.name !== REJECT_QUESTION_TOOL_NAME) continue
    const expl = tc.arguments?.explanation
    const reasonRaw = tc.arguments?.reason
    const explanation = typeof expl === 'string' ? expl.trim() : ''
    if (!explanation) continue
    const reason = normalizeRejectReason(reasonRaw)
    return { reason, explanation }
  }
  return null
}

/**
 * If the research agent refused the question via {@link REJECT_QUESTION_TOOL_NAME}, returns the
 * structured rejection (preferring executed tool results over assistant tool-call blocks).
 */
export function extractEarlyRejectionFromAgentMessages(messages: AgentMessage[]): EarlyRejectionExtract | null {
  let fallback: EarlyRejectionExtract | null = null
  for (const m of messages) {
    if (isToolResultMessage(m)) {
      const hit = detailsFromToolResult(m)
      if (hit) return hit
    }
    if (isAssistantMessage(m)) {
      const hit = fromAssistantToolCalls(m)
      if (hit) fallback = hit
    }
  }
  return fallback
}
