/** Non-empty trimmed message, or null if send should no-op. */
export function primaryComposerMessageOrNull(raw: string): string | null {
  const t = raw.trim()
  return t.length > 0 ? t : null
}

/** @deprecated Use {@link primaryComposerMessageOrNull}. */
export const wikiPrimaryChatMessageOrNull = primaryComposerMessageOrNull
