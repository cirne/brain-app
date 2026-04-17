/**
 * In-process publish/subscribe for UI coordination (single browser session).
 * Add new event variants to AppEvent as needed.
 */

export type WikiMutatedEvent = {
  type: 'wiki:mutated'
  source: 'agent' | 'user'
  /** Future: paths touched by tools */
  paths?: string[]
}

/** Emitted after nav ⌘R / full sync (wiki + inbox IMAP + calendar). Inbox surfaces subscribe to refetch `/api/inbox`. */
export type SyncCompletedEvent = {
  type: 'sync:completed'
}

/** Inbox thread archived in UI (full inbox or agent preview card); keep surfaces in sync. */
export type InboxArchivedEvent = {
  type: 'inbox:archived'
  messageId: string
}

/** Chat list in the sidebar should reload (new session, title, or persisted turn). */
export type ChatSessionsChangedEvent = {
  type: 'chat:sessions-changed'
}

export type AppEvent =
  | WikiMutatedEvent
  | SyncCompletedEvent
  | InboxArchivedEvent
  | ChatSessionsChangedEvent

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
