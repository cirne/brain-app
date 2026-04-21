import { renderMarkdown } from '../markdown.js'

/** Upper bound for very large streamed payloads (e.g. me.md preview). */
export const STREAMING_AGENT_MD_MAX = 50_000

/**
 * Markdown → HTML for in-flight assistant text (chat, onboarding). Caps optional length before parse.
 */
export function streamingAgentMessageHtml(content: string, maxLength?: number): string {
  const capped =
    maxLength !== undefined && content.length > maxLength ? content.slice(0, maxLength) : content
  return renderMarkdown(capped)
}
