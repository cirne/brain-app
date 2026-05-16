/** Extract first Slack user mention id from message text (`<@U123>`). */
export function parseFirstSlackUserMention(text: string): string | null {
  const m = text.match(/<@(U[A-Z0-9]+)>/i)
  return m?.[1] ?? null
}
