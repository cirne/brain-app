/** Platform-agnostic messaging (OPP-117/118). Ambassador/policy layers deferred. */

export type MessagingVenue = 'dm' | 'private_group' | 'public_channel'

export type MessagingQuery = {
  slackTeamId: string
  requesterSlackUserId: string
  targetSlackUserId?: string
  venue: MessagingVenue
  text: string
  rawEventRef: unknown
  channelId: string
  threadTs?: string
}

/**
 * Slack-specific return address for a pending approval.
 * Stored on the b2b_inbound session so both Brain UI and Block Kit buttons
 * can route the approved reply back to the Slack requester.
 */
export type SlackDelivery = {
  slackTeamId: string
  requesterSlackUserId: string
  requesterChannelId: string
  requesterThreadTs?: string
  ownerSlackUserId: string
  /** Bot's DM channel with the owner — populated before sendApprovalRequest. */
  ownerApprovalChannelId: string
  /** message_ts of the Block Kit message — set after sendApprovalRequest. */
  ownerApprovalMessageTs?: string
  /** Display hint for the requester (display name or @mention). */
  requesterDisplayHint?: string
  ownerDisplayName: string
}

export type ApprovalDraft = {
  sessionId: string
  ownerTenantUserId: string
  draftText: string
  originalQuestion: string
  slackDelivery: SlackDelivery
}

export type ApprovalDecision =
  | { kind: 'approve'; ownerTenantUserId: string; sessionId: string; editedText?: string }
  | { kind: 'decline'; ownerTenantUserId: string; sessionId: string }

export type MessagingAdapter = {
  parseEvent(event: unknown, teamId?: string): MessagingQuery | null
  sendResponse(query: MessagingQuery, text: string): Promise<void>
  /** Post Block Kit approval request to owner's Slack DM. Returns the message ts. */
  sendApprovalRequest(draft: ApprovalDraft): Promise<{ approvalMessageTs: string; approvalChannelId: string }>
  /** Parse a raw Slack interactions payload (form-encoded JSON). */
  parseInteraction(rawPayload: unknown): ApprovalDecision | null
  /** Post the final approved reply to the requester's channel/thread. */
  postFinalReply(
    target: { channelId: string; threadTs?: string; slackTeamId: string },
    text: string,
    attribution: string,
  ): Promise<void>
  /** Update the owner's Block Kit message to show sent/declined status. */
  updateApprovalMessage(
    ts: string,
    channelId: string,
    slackTeamId: string,
    status: 'approved' | 'declined',
  ): Promise<void>
}
