/**
 * OpenAI **Responses API** quirks for reasoning / thinking.
 *
 * pi-agent-core maps `thinkingLevel: "off"` → `reasoning.effort: "none"` for compatible models.
 * Some model families **reject** `effort: "none"` and require at least `"low"`; we remap only for those.
 *
 * This list is authoritative for Brain’s **`patchOpenAiReasoningNoneEffort`** behaviour.
 * Extend it when validation or API errors prove a model needs the workaround.
 */

/** Normalize `model.id` from pi-ai (strip optional provider prefix). */
export function normalizeOpenAiStyleModelId(id: string): string {
  const t = id.trim()
  const slash = t.indexOf('/')
  if (slash > 0) return t.slice(slash + 1)
  return t
}

/**
 * Exact Brain / pi-ai `model.id` values (already normalized — no `openai/` prefix).
 *
 * Prefer adding here over heuristics. When in doubt after a regression, add the id and cite the failure in a commit.
 */
export const MODEL_IDS_REJECTING_OPENAI_REASONING_EFFORT_NONE: ReadonlySet<string> = new Set([
  'codex-mini-latest',
  'gpt-5-codex',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
])

/**
 * True when **`reasoning.effort: "none"` must be bumped to `"low"`** before `responses.create`.
 */
export function openAiResponsesModelRejectsReasoningEffortNone(modelId: string): boolean {
  const id = normalizeOpenAiStyleModelId(modelId).toLowerCase()
  return MODEL_IDS_REJECTING_OPENAI_REASONING_EFFORT_NONE.has(id)
}
