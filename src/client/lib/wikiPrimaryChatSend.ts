/** Non-empty trimmed message, or null if send should no-op. */
export function wikiPrimaryChatMessageOrNull(raw: string): string | null {
  const t = raw.trim()
  return t.length > 0 ? t : null
}
