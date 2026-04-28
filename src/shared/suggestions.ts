/**
 * Structured next-step UI for onboarding (and future flows). Returned by POST /api/onboarding/suggestions;
 * not agent tools — plain JSON from a dedicated LLM completion.
 */

export type SuggestionChoice = { label: string; submit: string; id?: string }

export type SuggestionCheckboxItem = { label: string; id: string }

/** Optional hint for the chat composer textarea (shown when suggestions are present). */
export type SuggestionComposerHint = {
  composerPlaceholder?: string
}

/** Discriminated union; `null` means “no suggestions for this turn”. */
export type SuggestionSet =
  | ({ type: 'chips'; choices: SuggestionChoice[] } & SuggestionComposerHint)
  | ({ type: 'radio'; prompt?: string; choices: SuggestionChoice[] } & SuggestionComposerHint)
  | ({
      type: 'checkboxes'
      prompt?: string
      items: SuggestionCheckboxItem[]
      submitPrefix: string
    } & SuggestionComposerHint)

const CHOICES_MIN = 1
const CHOICES_MAX = 8
const LABEL_MAX = 60
const SUBMIT_MAX = 1000
const ID_MAX = 64
const CHECKBOX_ITEMS_MIN = 1
const CHECKBOX_ITEMS_MAX = 12
const PREFIX_MAX = 200
const COMPOSER_PLACEHOLDER_MAX = 200

function trimStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function normalizeChoice(raw: unknown): SuggestionChoice | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const label = trimStr(o.label)
  const submit = trimStr(o.submit)
  if (!label || !submit) return null
  if (label.length > LABEL_MAX || submit.length > SUBMIT_MAX) return null
  const idRaw = o.id
  if (idRaw !== undefined) {
    const id = trimStr(idRaw)
    if (!id || id.length > ID_MAX) return null
    return { label, submit, id }
  }
  return { label, submit }
}

function normalizeChoices(arr: unknown): SuggestionChoice[] | null {
  if (!Array.isArray(arr)) return null
  if (arr.length < CHOICES_MIN || arr.length > CHOICES_MAX) return null
  const out: SuggestionChoice[] = []
  const seen = new Set<string>()
  for (const row of arr) {
    const c = normalizeChoice(row)
    if (!c) return null
    const key = c.label.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    out.push(c)
  }
  return out
}

/** Valid optional `composerPlaceholder` from parsed JSON; omitted when absent or invalid. */
function composerPlaceholderFromRaw(o: Record<string, unknown>): { composerPlaceholder?: string } {
  const raw = o.composerPlaceholder
  if (raw === undefined) return {}
  if (typeof raw !== 'string') return {}
  const t = raw.trim()
  if (!t || t.length > COMPOSER_PLACEHOLDER_MAX) return {}
  return { composerPlaceholder: t }
}

/** Non-empty placeholder string when the suggestion set includes one. */
export function getSuggestionComposerPlaceholder(
  set: SuggestionSet | null | undefined,
): string | undefined {
  if (!set) return undefined
  const p = set.composerPlaceholder
  return typeof p === 'string' && p.trim() ? p.trim() : undefined
}

function normalizeCheckboxItems(arr: unknown): SuggestionCheckboxItem[] | null {
  if (!Array.isArray(arr)) return null
  if (arr.length < CHECKBOX_ITEMS_MIN || arr.length > CHECKBOX_ITEMS_MAX) return null
  const out: SuggestionCheckboxItem[] = []
  const seenId = new Set<string>()
  for (const row of arr) {
    if (row == null || typeof row !== 'object' || Array.isArray(row)) return null
    const o = row as Record<string, unknown>
    const label = trimStr(o.label)
    const id = trimStr(o.id)
    if (!label || !id) return null
    if (label.length > LABEL_MAX || id.length > ID_MAX) return null
    if (seenId.has(id.toLowerCase())) return null
    seenId.add(id.toLowerCase())
    out.push({ label, id })
  }
  return out
}

/** Validate unknown JSON into {@link SuggestionSet} or null. Malformed → null. */
export function parseSuggestionSetUnknown(raw: unknown): SuggestionSet | null {
  if (raw === null) return null
  if (raw === undefined) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const type = trimStr(o.type)
  if (type === 'chips') {
    const choices = normalizeChoices(o.choices)
    if (!choices) return null
    return { type: 'chips', choices, ...composerPlaceholderFromRaw(o) }
  }
  if (type === 'radio') {
    const choices = normalizeChoices(o.choices)
    if (!choices) return null
    const promptRaw = o.prompt
    const p = promptRaw === undefined ? '' : trimStr(promptRaw)
    if (p.length > 300) return null
    const hint = composerPlaceholderFromRaw(o)
    if (p) {
      return { type: 'radio', prompt: p, choices, ...hint }
    }
    return { type: 'radio', choices, ...hint }
  }
  if (type === 'checkboxes') {
    const items = normalizeCheckboxItems(o.items)
    if (!items) return null
    const submitPrefix = trimStr(o.submitPrefix)
    if (!submitPrefix || submitPrefix.length > PREFIX_MAX) return null
    const promptRaw = o.prompt
    const p = promptRaw === undefined ? '' : trimStr(promptRaw)
    if (p.length > 300) return null
    const hint = composerPlaceholderFromRaw(o)
    if (p) {
      return { type: 'checkboxes', prompt: p, items, submitPrefix, ...hint }
    }
    return { type: 'checkboxes', items, submitPrefix, ...hint }
  }
  return null
}

/**
 * Parse model output: trim, strip optional ```json fences, `JSON.parse`, validate.
 * Returns `null` on any failure (including invalid shape).
 */
export function parseSuggestionSetFromLlmText(text: string): SuggestionSet | null {
  let s = text.trim()
  if (!s) return null
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m
  const m = s.match(fence)
  if (m) s = m[1].trim()
  if (s === 'null' || s === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(s) as unknown
  } catch {
    return null
  }
  return parseSuggestionSetUnknown(parsed)
}
