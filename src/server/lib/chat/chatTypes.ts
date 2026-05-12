/**
 * Mirrors client ChatMessage shape in src/client/lib/agentUtils.ts — keep in sync.
 */

import type { LlmUsageSnapshot } from '@server/lib/llm/llmUsage.js'

export type { LlmUsageSnapshot }

export type ToolCall = {
  id: string
  name: string
  args: unknown
  result?: string
  details?: unknown
  isError?: boolean
  done: boolean
}

export type TextPart = { type: 'text'; content: string }
export type ToolPart = { type: 'tool'; toolCall: ToolCall }
export type MessagePart = TextPart | ToolPart

export type ChatMessage = {
  /** Stable row id for list reconciliation (client + persisted transcript). Missing on legacy rows; hydrate assigns one. */
  id?: string
  role: 'user' | 'assistant'
  content: string
  parts?: MessagePart[]
  thinking?: string
  /** Set on assistant rows when the model reported usage (sum over tool rounds for that reply). */
  usage?: LlmUsageSnapshot
}

export type ChatSessionType = 'own' | 'b2b_outbound' | 'b2b_inbound'
export type ApprovalState = 'pending' | 'approved' | 'declined' | 'auto'

/** One in-progress assistant message while streaming SSE (server mirror of client state). */
export type AssistantTurnState = {
  thinking?: string
  parts: MessagePart[]
}

export type ChatSessionDocV1 = {
  version: 1
  sessionId: string
  createdAt: string
  updatedAt: string
  title: string | null
  sessionType: ChatSessionType
  remoteGrantId: string | null
  remoteHandle: string | null
  remoteDisplayName: string | null
  approvalState: ApprovalState | null
  messages: ChatMessage[]
}
