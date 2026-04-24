/**
 * Coordinates overlapping async work so only the latest "generation" may commit UI state.
 *
 * Use when navigation or keyed props can start a new `fetch` before the previous one finishes
 * (agent tools, rapid clicks, debounced search). After each `await`, bail with
 * `if (latest.isStale(token)) return` before mutating `$state`.
 *
 * **Use for:** inbox/thread/detail loads, wiki/file viewers keyed by path, session load, search
 * results, calendar week fetch, any overlay-bound GET that writes shared UI state.
 *
 * **Do not use for:** fire-and-forget analytics, POSTs that must finish regardless of navigation
 * (unless you explicitly want to abort them).
 *
 * Architecture: `docs/architecture/client-async-latest.md`
 */

export type AsyncLatestOptions = {
  /** When true, each `begin()` aborts the previous request's `signal` (for `fetch(..., { signal })`). */
  abortPrevious?: boolean
}

export type AsyncLatestBegin = {
  /** Generation captured at the start of this logical request; pass to `isStale`. */
  token: number
  /** Pass to `fetch` when `abortPrevious` is enabled (or always — safe to pass). */
  signal: AbortSignal
}

export function createAsyncLatest(options: AsyncLatestOptions = {}) {
  const abortPrevious = options.abortPrevious === true
  let generation = 0
  let controller: AbortController | null = null

  return {
    /**
     * Start a new logical load. Supersedes any in-flight work from older tokens
     * (and aborts the previous `signal` when `abortPrevious` is true).
     */
    begin(): AsyncLatestBegin {
      generation += 1
      const token = generation
      if (abortPrevious && controller) {
        controller.abort()
      }
      controller = new AbortController()
      return { token, signal: controller.signal }
    },

    /** True if a newer `begin()` ran after this `token` was issued. */
    isStale(token: number): boolean {
      return token !== generation
    },
  }
}

/** Whether `fetch` (or a wait) failed because the `AbortSignal` was aborted. */
export function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return true
  return e instanceof Error && e.name === 'AbortError'
}
