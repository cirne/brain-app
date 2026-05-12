import type { BackgroundAgentDoc } from '../statusBar/backgroundAgentTypes.js'
import { notifyConnected, notifyPossibleConnectionIssue } from '../connectionStatus.js'
import { backgroundAgentsFromEvents, yourWikiDocFromEvents } from './hubEventsStores.js'

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

const hubNotificationsRefreshSubscribers = new Set<() => void>()

/** Subscribe to unread-notification refresh: SSE `notifications_changed` and reconnect `onopen`. */
export function subscribeHubNotificationsRefresh(cb: () => void): () => void {
  hubNotificationsRefreshSubscribers.add(cb)
  return () => {
    hubNotificationsRefreshSubscribers.delete(cb)
  }
}

function notifyHubNotificationsRefreshSubscribers(): void {
  for (const cb of hubNotificationsRefreshSubscribers) {
    try {
      cb()
    } catch {
      /* ignore */
    }
  }
}

/** Vitest / test isolation */
export function resetHubNotificationsRefreshSubscribersForTests(): void {
  hubNotificationsRefreshSubscribers.clear()
}

/**
 * Long-lived SSE to `/api/events`. Idempotent stop via returned disposer.
 * Reconnects with exponential backoff after errors (vault locked, server restart).
 */
export function startHubEventsConnection(): () => void {
  let es: EventSource | null = null
  let stopped = false
  let backoffMs = INITIAL_BACKOFF_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function scheduleReconnect() {
    clearReconnect()
    if (stopped) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, backoffMs)
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
  }

  function connect() {
    if (stopped) return
    es?.close()
    es = new EventSource('/api/events')

    es.addEventListener('your_wiki', (ev) => {
      try {
        const doc = JSON.parse((ev as MessageEvent).data as string) as BackgroundAgentDoc
        yourWikiDocFromEvents.set(doc)
      } catch {
        /* ignore */
      }
    })

    es.addEventListener('background_agents', (ev) => {
      try {
        const j = JSON.parse((ev as MessageEvent).data as string) as { agents?: BackgroundAgentDoc[] }
        if (Array.isArray(j.agents)) backgroundAgentsFromEvents.set(j.agents)
      } catch {
        /* ignore */
      }
    })

    es.addEventListener('ping', () => {})

    es.addEventListener('notifications_changed', () => {
      notifyHubNotificationsRefreshSubscribers()
    })

    es.onopen = () => {
      backoffMs = INITIAL_BACKOFF_MS
      notifyConnected()
      notifyHubNotificationsRefreshSubscribers()
    }

    es.onerror = () => {
      es?.close()
      es = null
      notifyPossibleConnectionIssue()
      scheduleReconnect()
    }
  }

  connect()

  return () => {
    stopped = true
    clearReconnect()
    es?.close()
    es = null
  }
}
