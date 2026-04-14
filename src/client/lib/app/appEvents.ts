/**
 * In-process publish/subscribe for UI coordination (single browser session).
 * Add new event variants to AppEvent as needed.
 */

export type WikiMutatedEvent = {
  type: 'wiki:mutated'
  source: 'agent'
  /** Future: paths touched by tools */
  paths?: string[]
}

export type SyncCompletedEvent = {
  type: 'sync:completed'
}

export type AppEvent = WikiMutatedEvent | SyncCompletedEvent

const listeners = new Set<(event: AppEvent) => void>()

/**
 * Register a listener. Returns unsubscribe.
 * Listeners are notified synchronously; snapshot iteration avoids re-entrancy issues.
 */
export function subscribe(handler: (event: AppEvent) => void): () => void {
  listeners.add(handler)
  return () => {
    listeners.delete(handler)
  }
}

export function emit(event: AppEvent): void {
  for (const handler of [...listeners]) {
    try {
      handler(event)
    } catch {
      // Isolated failure — other listeners still run
    }
  }
}
