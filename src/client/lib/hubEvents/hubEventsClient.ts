import type { BackgroundAgentDoc } from '../statusBar/backgroundAgentTypes.js'
import { backgroundAgentsFromEvents, yourWikiDocFromEvents } from './hubEventsStores.js'

const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30_000

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

    es.onopen = () => {
      backoffMs = INITIAL_BACKOFF_MS
    }

    es.onerror = () => {
      es?.close()
      es = null
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
