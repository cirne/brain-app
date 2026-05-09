/**
 * Wire submit string for closing quick-reply chips. When POST /api/chat `message`
 * equals this (trimmed), the server skips the LLM and emits `finish_conversation`
 * immediately. Chip **labels** stay natural language; only **submit** uses this constant.
 */
export const BRAIN_FINISH_CONVERSATION_SUBMIT = '__brain_finish_conversation__'

/**
 * Tool result / SSE result text for `finish_conversation` (LLM tool + no-LLM shortcut).
 * Keep in sync with `createUiAgentTools` (`uiAgentTools.ts`).
 */
export const FINISH_CONVERSATION_TOOL_RESULT_TEXT =
  'Conversation finish signaled; the app will apply the close/new-chat action.'

export function isBrainFinishConversationSubmit(message: string): boolean {
  return message.trim() === BRAIN_FINISH_CONVERSATION_SUBMIT
}
