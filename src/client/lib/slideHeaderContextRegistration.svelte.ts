import { setContext } from 'svelte'

/**
 * Header cell shared between {@link SlideOver} and the pane that owns the header state.
 *
 * Design (BUG-047):
 * - The parent (SlideOver) owns one stable reactive cell per overlay/header type.
 * - Children {@link SlideHeaderCell.claim} the cell once during setup and receive a
 *   {@link SlideHeaderController} bound to that owner token.
 * - Children update individual scalar fields via {@link SlideHeaderController.patch}
 *   instead of re-registering whole payloads from `$effect`.
 * - Cleanup is owner-token aware: stale children calling
 *   {@link SlideHeaderController.clear} after another claim has taken over is a no-op.
 *
 * This deliberately replaces the previous `register(payload)`/`updateSeq`/`equals`
 * design, which produced effect_update_depth_exceeded loops in production whenever
 * children re-published fresh payload literals from `$effect`.
 */
export type SlideHeaderCell<T extends object> = {
  /** Reactive snapshot of the currently-claimed state, or `null` when not claimed. */
  get current(): T | null
  /** True when a child currently owns the cell. UI uses this instead of `current != null`. */
  get claimed(): boolean
  /**
   * Claim the cell. Any previous owner is replaced; the prior controller becomes stale.
   * The returned controller is bound to a private owner token, so it can mutate / clear
   * the cell without leaking access to other claimers.
   */
  claim: (_initial: T) => SlideHeaderController<T>
}

export type SlideHeaderController<T extends object> = {
  /** Reactive view of the live cell state. Returns `null` when this controller is stale. */
  get state(): T | null
  /**
   * Apply a shallow patch to the cell. Only fields whose values differ (`Object.is`) are
   * assigned, so no-op patches do not perturb downstream reactivity.
   *
   * Stale (no longer current) controllers silently no-op — used by `onDestroy`-style
   * cleanups that may run after the cell has been re-claimed by a sibling.
   */
  patch: (_partial: Partial<T>) => void
  /** Replace the entire state (rare; prefer `patch`). Stale controllers no-op. */
  replace: (_next: T) => void
  /** Release the cell. No-op if this controller is no longer the active owner. */
  clear: () => void
  /** True when this controller still owns the cell. */
  get isOwner(): boolean
}

/**
 * Build a {@link SlideHeaderCell} without binding it to context — useful for unit tests
 * and callers that want to set the context themselves.
 */
export function makeSlideHeaderCell<T extends object>(): SlideHeaderCell<T> {
  let current = $state<T | null>(null)
  let owner: symbol | null = null

  function makeController(token: symbol): SlideHeaderController<T> {
    return {
      get state() {
        return owner === token ? current : null
      },
      get isOwner() {
        return owner === token
      },
      patch(partial: Partial<T>) {
        if (owner !== token) return
        const cur = current
        if (cur == null) return
        let changed = false
        for (const k of Object.keys(partial) as (keyof T)[]) {
          const next = partial[k] as T[keyof T]
          if (!Object.is(cur[k], next)) {
            cur[k] = next
            changed = true
          }
        }
        if (changed) {
          // Reassign to ensure consumers tracking `current` (not just deep field reads) re-run.
          current = cur
        }
      },
      replace(next: T) {
        if (owner !== token) return
        current = next
      },
      clear() {
        if (owner !== token) return
        owner = null
        current = null
      },
    }
  }

  return {
    get current() {
      return current
    },
    get claimed() {
      return current !== null && owner !== null
    },
    claim(initial: T) {
      const token = Symbol('slideHeaderOwner')
      owner = token
      // Shallow-copy so callers can keep using the original object as a "static initializer".
      current = { ...initial }
      return makeController(token)
    },
  }
}

/**
 * Create a reactive {@link SlideHeaderCell} and bind it to the given context key.
 *
 * Children read the cell with `getContext(key)`; the parent (typically `SlideOver`) reads
 * `cell.current` / `cell.claimed` when rendering its L2 header.
 */
export function createSlideHeaderCell<T extends object>(key: unknown): SlideHeaderCell<T> {
  const cell = makeSlideHeaderCell<T>()
  setContext(key, cell)
  return cell
}
