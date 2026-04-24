/**
 * Mirrors client ChatMessage shape in src/client/lib/agentUtils.ts — keep in sync.
 */

import type { LlmUsageSnapshot } from './llmUsage.js'

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
  role: 'user' | 'assistant'
  content: string
  parts?: MessagePart[]
  thinking?: string
  /** Set on assistant rows when the model reported usage (sum over tool rounds for that reply). */
  usage?: LlmUsageSnapshot
}

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
  messages: ChatMessage[]
}
