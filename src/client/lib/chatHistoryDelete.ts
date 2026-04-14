/** Label shown in the delete-chat confirmation (truncated for layout). */
export function labelForDeleteChatDialog(rowTitle: string, max = 80): string {
  const t = rowTitle.trim()
  if (!t) return 'New chat'
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}
