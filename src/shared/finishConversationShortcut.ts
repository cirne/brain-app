/**
 * Wire submit string for closing quick-reply chips. When POST /api/chat `message`
 * equals this (trimmed), the server skips the LLM and emits `finish_conversation`
 * immediately. Chip **labels** stay natural language; only **submit** uses this constant.
 */
export const BRAIN_FINISH_CONVERSATION_SUBMIT = '__brain_finish_conversation__'

export function isBrainFinishConversationSubmit(message: string): boolean {
  return message.trim() === BRAIN_FINISH_CONVERSATION_SUBMIT
}
