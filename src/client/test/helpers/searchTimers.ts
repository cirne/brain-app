import { afterEach, beforeEach, vi } from 'vitest'

/** Use at `describe` scope for Search.svelte debounce (250ms) tests. */
export function useSearchDebounceTimers(): void {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })
}
