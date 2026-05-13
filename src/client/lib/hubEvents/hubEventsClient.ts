import type { BackgroundAgentDoc } from '../statusBar/backgroundAgentTypes.js'
import { notifyConnected, notifyPossibleConnectionIssue } from '../connectionStatus.js'
import { backgroundAgentsFromEvents, yourWikiDocFromEvents } from './hubEventsStores.js'

/** Payload from SSE `tunnel_activity` (brain tunnel inbox / outbound updates). */
export type TunnelActivityPayload = {
  scope?: string
  inboundSessionId?: string | null
  outboundSessionId?: string | null
  grantId?: string | null
}

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

const hubNotificationsRefreshSubscribers = new Set<() => void>()
const tunnelActivitySubscribers = new Set<(payload: TunnelActivityPayload | null) => void>()

/** Subscribe to `/api/events` `{ event: tunnel_activity }` — push-driven tunnel UI (no polling). */
export function subscribeTunnelActivity(cb: (payload: TunnelActivityPayload | null) => void): () => void {
  tunnelActivitySubscribers.add(cb)
  return () => {
    tunnelActivitySubscribers.delete(cb)
  }
}

function notifyTunnelActivitySubscribers(payload: TunnelActivityPayload | null): void {
  for (const handler of [...tunnelActivitySubscribers]) {
    try {
      handler(payload)
    } catch {
      /* ignore */
    }
  }
}

/** Vitest / test isolation */
export function resetTunnelActivitySubscribersForTests(): void {
  tunnelActivitySubscribers.clear()
}

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

    es.addEventListener('tunnel_activity', (ev: Event) => {
      const raw = (ev as MessageEvent).data as unknown
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        notifyTunnelActivitySubscribers(null)
        return
      }
      try {
        const j = JSON.parse(raw) as unknown
        notifyTunnelActivitySubscribers(j && typeof j === 'object' ? (j as TunnelActivityPayload) : null)
      } catch {
        notifyTunnelActivitySubscribers(null)
      }
    })

    es.onopen = () => {
      backoffMs = INITIAL_BACKOFF_MS
      notifyConnected()
      notifyHubNotificationsRefreshSubscribers()
      notifyTunnelActivitySubscribers(null)
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
