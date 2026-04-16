/** Whether the chat history row should show the “agent working” icon instead of the static chat glyph. */
export function chatRowShowsAgentWorking(
  item: { type: 'chat' | 'email' | 'doc'; sessionId?: string },
  activeSessionId: string | null,
  activeSessionStreaming: boolean,
): boolean {
  return (
    item.type === 'chat' &&
    !!item.sessionId &&
    item.sessionId === activeSessionId &&
    activeSessionStreaming
  )
}
