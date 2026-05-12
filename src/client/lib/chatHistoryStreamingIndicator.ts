/** Whether the chat history row should show the “agent working” icon instead of the static chat glyph. */
export function chatRowShowsAgentWorking(
  item: { type: 'chat' | 'doc' | 'tunnel'; sessionId?: string },
  streamingSessionIds: ReadonlySet<string>,
): boolean {
  return (
    (item.type === 'chat' || item.type === 'tunnel') &&
    !!item.sessionId &&
    streamingSessionIds.has(item.sessionId)
  )
}
