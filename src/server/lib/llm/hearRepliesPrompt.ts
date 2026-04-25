import type { AgentMessage } from '@mariozechner/pi-agent-core'

/** App-injected first user line in a hear-replies turn (not persisted as user chat text). */
export function hearRepliesAppContextText(): string {
  return [
    '[Braintunnel app context — not shown in chat]',
    'The user turned on **Read answers aloud** for this request.',
    '**You must call the `speak` tool exactly once** this turn, after any research or gather-info tools you need, and **before** you write your main markdown reply. Do not stream or write the long answer until after `speak` has been invoked.',
    'Use `speak` for one or two **short** plain sentences (no markdown, no links) that **preview the gist** for someone who is listening—a brief summary, not a readout of the final answer. Do not skip `speak` because you used many tools.',
    'Put the full answer, links, and lists only in your markdown **after** the `speak` call.',
  ].join('\n')
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
