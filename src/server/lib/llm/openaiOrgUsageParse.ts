/**
 * Safe parsing for OpenAI admin API JSON bodies (used by {@link ../openaiOrgUsage.js}).
 */

export type ParsedJson = { ok: true; value: unknown } | { ok: false; error: string }

export function parseOpenAiJsonText(text: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
}

/** Normalize list payload (`result` vs `results`) from usage API buckets. */
export function usageBucketRows(body: unknown): Record<string, unknown>[] {
  if (body === null || typeof body !== 'object') return []
  const b = body as { result?: unknown; results?: unknown }
  const rows = (b.result ?? b.results) as unknown
  if (!Array.isArray(rows)) return []
  return rows.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
}
