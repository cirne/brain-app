import type { ChatMessage } from '../agentUtils.js'
import {
  extractSuggestReplyChoicesFromAssistantParts,
  suggestReplyDetailsJsonObject,
  type SuggestReplyChoice as CoreChoice,
} from '@shared/suggestReplyChoicesCore.js'

export type QuickReplyChoice = CoreChoice
export { extractSuggestReplyChoicesFromToolCall as extractSuggestReplyChoices } from '@shared/suggestReplyChoicesCore.js'

/**
 * Choices for the composer context bar: last assistant turn only, hidden while streaming.
 * Multiple `suggest_reply_options` in that turn: last successful call wins.
 */
export function extractLatestSuggestReplyChoices(
  messages: ChatMessage[],
  streaming: boolean,
): QuickReplyChoice[] {
  if (streaming) return []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== 'assistant') continue
    return extractSuggestReplyChoicesFromAssistantParts(messages[i].parts ?? [])
  }
  return []
}

/**
 * Some models echo the `suggest_reply_options` JSON at the end of prose after the tool runs.
 * Chips still come from the tool part; strip this duplicate suffix so it is not shown as markdown.
 */
export function stripTrailingSuggestReplyChoicesJson(text: string): string {
  const trimmed = text.replace(/\s+$/u, '')
  let brace = trimmed.lastIndexOf('{')
  while (brace >= 0) {
    const tail = trimmed.slice(brace)
    try {
      const parsed = JSON.parse(tail) as unknown
      if (suggestReplyDetailsJsonObject(parsed) != null) {
        return trimmed.slice(0, brace).replace(/\s+$/u, '')
      }
    } catch {
      // not valid JSON from this `{`
    }
    brace = trimmed.lastIndexOf('{', brace - 1)
  }
  return text
}
