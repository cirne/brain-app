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
  /** Outbound tunnel: placeholder assistant row until the answering side approves (`b2bChat` / OPP-111). */
  b2bDelivery?: 'awaiting_peer_review' | 'no_reply_expected' | 'dismissed'
  /** Set on assistant rows when the model reported usage (sum over tool rounds for that reply). */
  usage?: LlmUsageSnapshot
}

export type ChatSessionType = 'own' | 'b2b_outbound' | 'b2b_inbound'
export type ApprovalState =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'auto'
  | 'dismissed'
  | 'no_response_expected'

/** One in-progress assistant message while streaming SSE (server mirror of client state). */
export type AssistantTurnState = {
  thinking?: string
  parts: MessagePart[]
}

/**
 * Slack return-address metadata on a b2b_inbound session (OPP-118).
 * Stored alongside the session so both the Brain review UI and Slack Block Kit
 * buttons can route the approved reply back to the original Slack requester.
 */
export type SlackSessionDelivery = {
  slackTeamId: string
  requesterSlackUserId: string
  requesterChannelId: string
  requesterThreadTs?: string
  /** dm | private_group | public_channel */
  requesterVenue?: 'dm' | 'private_group' | 'public_channel'
  ownerSlackUserId: string
  ownerApprovalChannelId: string
  /** message_ts of the Block Kit — set after sendApprovalRequest. */
  ownerApprovalMessageTs?: string
  requesterDisplayHint?: string
  ownerDisplayName: string
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
  /** Cold-query handshake (OPP-112): present when `is_cold_query` in tenant DB. */
  isColdQuery?: boolean
  coldPeerUserId?: string | null
  coldLinkedSessionId?: string | null
  /** Inbound B2B: false when preflight classified the peer message as FYI (no draft/review). */
  expectsResponse?: boolean
  /** Slack integration (OPP-118): set when the inbound query arrived from Slack. */
  slackDelivery?: SlackSessionDelivery
  messages: ChatMessage[]
}
