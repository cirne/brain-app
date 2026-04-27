/**
 * Core extraction for `suggest_reply_options` tool payloads. Shared by client UI and
 * server repair path — keep in sync with client expectations.
 */
export type SuggestReplyChoice = { label: string; submit: string; id?: string }

/**
 * Tool-call shape (client `ToolCall` and server `chatTypes.ToolCall` are compatible).
 */
export type SuggestReplyToolCallLike = {
  id: string
  name: string
  args: unknown
  result?: string
  details?: unknown
  isError?: boolean
  done: boolean
}

function detailsChooseArray(d: unknown): SuggestReplyChoice[] | null {
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
  const out: SuggestReplyChoice[] = []
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

/** For stripping leaked JSON at end of assistant markdown (prose echo of tool). */
export function suggestReplyDetailsJsonObject(parsed: unknown): SuggestReplyChoice[] | null {
  return detailsChooseArray(parsed)
}

function argsChoicesArray(args: unknown): SuggestReplyChoice[] | null {
  if (args == null || typeof args !== 'object') return null
  const ch = (args as { choices?: unknown }).choices
  if (!Array.isArray(ch)) return null
  const out: SuggestReplyChoice[] = []
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
export function extractSuggestReplyChoicesFromToolCall(
  toolCall: SuggestReplyToolCallLike,
): SuggestReplyChoice[] | null {
  if (toolCall.name !== 'suggest_reply_options' || !toolCall.done) return null
  const fromDetails = detailsChooseArray(toolCall.details)
  if (fromDetails) return fromDetails
  return argsChoicesArray(toolCall.args)
}

export type PartLike = { type: 'text'; content: string } | { type: 'tool'; toolCall: SuggestReplyToolCallLike }

/**
 * Tappable options from a single assistant turn's parts, in part order. If
 * `suggest_reply_options` runs more than once, the **last successful** result wins
 * (later calls overwrite earlier valid chips).
 */
export function extractSuggestReplyChoicesFromAssistantParts(
  parts: PartLike[],
): SuggestReplyChoice[] {
  let best: SuggestReplyChoice[] = []
  for (const part of parts) {
    if (part.type !== 'tool' || part.toolCall.name !== 'suggest_reply_options') continue
    const choices = extractSuggestReplyChoicesFromToolCall(part.toolCall)
    if (choices && choices.length > 0) best = choices
  }
  return best
}

/**
 * True if this assistant turn has at least one successful `suggest_reply_options` that would be shown
 * (last successful wins when the tool is invoked more than once).
 */
export function assistantPartsHaveValidSuggestReply(parts: PartLike[]): boolean {
  return extractSuggestReplyChoicesFromAssistantParts(parts).length > 0
}
