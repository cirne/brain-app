/** All Slack user mention ids in message order (`<@U123>`). */
export function parseAllSlackUserMentions(text: string): string[] {
  return [...text.matchAll(/<@(U[A-Z0-9]+)>/gi)].map((m) => m[1]!)
}

/** Extract first Slack user mention id from message text (`<@U123>`). */
export function parseFirstSlackUserMention(text: string): string | null {
  return parseAllSlackUserMentions(text)[0] ?? null
}

/**
 * First user mention that is not in `excludeUserIds` (e.g. requester or bot in app_mention).
 */
export function parseTargetSlackUserMention(
  text: string,
  opts?: { excludeUserIds?: string[] },
): string | null {
  const exclude = new Set(opts?.excludeUserIds ?? [])
  for (const id of parseAllSlackUserMentions(text)) {
    if (!exclude.has(id)) return id
  }
  return null
}
