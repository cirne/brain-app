import type { ToolCall } from '../agentUtils.js'

export type QuickReplyChoice = { label: string; submit: string; id?: string }

/**
 * Structured `suggest_reply_options` tool payload (see `src/server/agent/tools.ts` `details`).
 * Success: `{ choices: [...] }`. Errors: `{ error: string }` (no chips).
 * The agent runtime may hand `details` to the client as a JSON string — parse that too.
 */
function detailsChooseArray(d: unknown): QuickReplyChoice[] | null {
  let parsed: unknown = d
  if (typeof d === 'string') {
    const t = d.trim()
    if (t.length === 0 || (t[0] !== '{' && t[0] !== '[')) return null
    try {
      parsed = JSON.parse(t) as unknown
    } catch {
      return null
    }
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as { error?: unknown; choices?: unknown }
  if (o.error != null) return null
  if (!Array.isArray(o.choices)) return null
  const out: QuickReplyChoice[] = []
  for (const row of o.choices) {
    if (row == null || typeof row !== 'object') return null
    const r = row as { label?: unknown; submit?: unknown; id?: unknown }
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    const submit = typeof r.submit === 'string' ? r.submit.trim() : ''
    if (!label || !submit) return null
    if (r.id !== undefined && typeof r.id !== 'string') return null
    out.push(
      r.id !== undefined
        ? { label, submit, id: r.id.trim() }
        : { label, submit },
    )
  }
  return out.length > 0 ? out : null
}

function argsChoicesArray(args: unknown): QuickReplyChoice[] | null {
  if (args == null || typeof args !== 'object') return null
  const ch = (args as { choices?: unknown }).choices
  if (!Array.isArray(ch)) return null
  const out: QuickReplyChoice[] = []
  for (const row of ch) {
    if (row == null || typeof row !== 'object') return null
    const r = row as { label?: unknown; submit?: unknown; id?: unknown }
    const label = typeof r.label === 'string' ? r.label : ''
    const submit = typeof r.submit === 'string' ? r.submit : ''
    if (!label?.trim() || !submit?.trim()) return null
    out.push(
      typeof r.id === 'string' && r.id.trim()
        ? { label: label.trim(), submit: submit.trim(), id: r.id.trim() }
        : { label: label.trim(), submit: submit.trim() },
    )
  }
  return out.length > 0 ? out : null
}

/** Tappable options for the suggest_reply_options tool; null if not applicable or invalid. */
export function extractSuggestReplyChoices(toolCall: ToolCall): QuickReplyChoice[] | null {
  if (toolCall.name !== 'suggest_reply_options' || !toolCall.done) return null
  const fromDetails = detailsChooseArray(toolCall.details)
  if (fromDetails) return fromDetails
  return argsChoicesArray(toolCall.args)
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
      if (detailsChooseArray(parsed) != null) {
        return trimmed.slice(0, brace).replace(/\s+$/u, '')
      }
    } catch {
      // not valid JSON from this `{`
    }
    brace = trimmed.lastIndexOf('{', brace - 1)
  }
  return text
}
