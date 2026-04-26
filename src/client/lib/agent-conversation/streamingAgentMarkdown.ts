import { renderMarkdown } from '../markdown.js'
import { stripTrailingSuggestReplyChoicesJson } from '../tools/suggestReplyChoices.js'

/** Upper bound for very large streamed payloads (e.g. me.md preview). */
export const STREAMING_AGENT_MD_MAX = 50_000

/**
 * Markdown → HTML for in-flight assistant text (chat, onboarding). Caps optional length before parse.
 */
export function streamingAgentMessageHtml(content: string, maxLength?: number): string {
  const cleaned = stripTrailingSuggestReplyChoicesJson(content)
  const capped =
    maxLength !== undefined && cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
  return renderMarkdown(capped)
}
