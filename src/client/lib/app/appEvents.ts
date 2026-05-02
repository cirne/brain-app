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

/** Hub (or other UI) updated chat tool row display; transcript should apply the same mode. */
export type ChatToolDisplayChangedEvent = {
  type: 'chat:tool-display-changed'
  mode: 'compact' | 'detailed'
}

/** Ripmail search index sources changed (e.g. `manage_sources` add/remove/edit local folder). Brain Hub refetches `/api/hub/sources`. */
export type HubSourcesChangedEvent = {
  type: 'hub:sources-changed'
}

/** Mac Messages device links changed (add / disconnect / wipe). Brain Hub refetches `/api/devices` for the hub row. */
export type HubDevicesChangedEvent = {
  type: 'hub:devices-changed'
}

/** Sidebar RECENTS (/api/nav/recents) mutated — chat sidebar refetches server list. */
export type NavRecentsChangedEvent = {
  type: 'nav:recents-changed'
}

/** Agent completed draft_email / edit_draft — EmailDraftEditor reloads when showing this id. */
export type EmailDraftRefreshEvent = {
  type: 'email-draft:refresh'
  draftId: string
}

/** Wiki share list / pending invites changed (create, accept, revoke). */
export type WikiSharesChangedEvent = {
  type: 'wiki-shares-changed'
}

export type AppEvent =
  | WikiMutatedEvent
  | SyncCompletedEvent
  | InboxArchivedEvent
  | ChatSessionsChangedEvent
  | ChatToolDisplayChangedEvent
  | HubSourcesChangedEvent
  | HubDevicesChangedEvent
  | NavRecentsChangedEvent
  | EmailDraftRefreshEvent
  | WikiSharesChangedEvent

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
