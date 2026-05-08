/**
 * Workspace-handle suggestion helpers for onboarding and the chat composer (`@` mention picker).
 * Calls the existing
 * `GET /api/account/workspace-handles?q=` endpoint without any contract change.
 *
 * The fetch uses a per-instance token so callers can race-protect interleaved
 * lookups without managing tokens themselves.
 */

/** Row returned by `GET /api/account/workspace-handles`. */
export type WorkspaceHandleEntry = {
  userId: string
  handle: string
  displayName?: string
  primaryEmail: string | null
}

export type WorkspaceHandleSuggestState = {
  loading: boolean
  /** Token of the latest in-flight fetch. Compare to detect stale resolves. */
  inFlightToken: number
}

/** Strip a single leading `@`, lowercase, and trim. */
export function normalizeHandleInput(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

/** Loose email check used to short-circuit handle suggestions when typing an email. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

/**
 * Fetch directory entries matching `query`. Returns the latest results plus the
 * token used for this request so callers can drop stale resolves.
 *
 * Errors are swallowed and surfaced as an empty result set; suggestions are progressive helpers.
 */
export async function fetchWorkspaceHandleSuggestions(
  query: string,
  token: number,
): Promise<{ token: number; results: WorkspaceHandleEntry[] }> {
  try {
    const url = `/api/account/workspace-handles?q=${encodeURIComponent(query)}`
    const res = await fetch(url)
    if (!res.ok) return { token, results: [] }
    const j = (await res.json().catch(() => ({}))) as { results?: WorkspaceHandleEntry[] }
    const results = Array.isArray(j.results) ? j.results : []
    return { token, results }
  } catch {
    return { token, results: [] }
  }
}

/**
 * Convenience wrapper that owns its own monotonic token. Each call increments
 * the token and resolves with `{ stale, results }`; callers should ignore stale
 * resolves.
 */
export function createWorkspaceHandleSuggester(): {
  fetch(query: string): Promise<{ stale: boolean; results: WorkspaceHandleEntry[] }>
} {
  let counter = 0
  return {
    async fetch(query: string) {
      const myToken = ++counter
      const { token, results } = await fetchWorkspaceHandleSuggestions(query, myToken)
      return { stale: token !== counter, results }
    },
  }
}
