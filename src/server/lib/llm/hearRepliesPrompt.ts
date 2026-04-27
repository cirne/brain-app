import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { readPromptFile } from '@server/lib/prompts/render.js'

/** App-injected first user line in a hear-replies turn (not persisted as user chat text). */
export function hearRepliesAppContextText(): string {
  return readPromptFile('hear-replies/app-context.hbs').trimEnd()
}

/**
 * Two user messages: app context, then the real user text. (pi-ai `Message` has no in-transcript `system` role.)
 */
export function buildHearRepliesPromptMessages(userText: string): AgentMessage[] {
  const ts = Date.now()
  return [
    {
      role: 'user',
      content: [{ type: 'text' as const, text: hearRepliesAppContextText() }],
      timestamp: ts,
    },
    {
      role: 'user',
      content: [{ type: 'text' as const, text: userText }],
      timestamp: ts + 1,
    },
  ]
}
