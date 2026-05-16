/** Platform-agnostic messaging (OPP-117). Ambassador/policy layers deferred. */

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

export type MessagingAdapter = {
  parseEvent(event: unknown, teamId?: string): MessagingQuery | null
  sendResponse(query: MessagingQuery, text: string): Promise<void>
}
