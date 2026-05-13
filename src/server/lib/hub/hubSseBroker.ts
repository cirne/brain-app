/**
 * Fan-out server push for Hub / Your Wiki / in-app notifications: subscribers are SSE streams
 * registered per vault session ({@link registerHubSseSubscriber}). Background runs flush via
 * {@link notifyBackgroundRunWritten}; notification table changes flush via
 * {@link notifyNotificationsChanged}; B2B tunnel signals via {@link notifyBrainTunnelActivity}.
 */
import type { BackgroundRunDoc } from '@server/lib/chat/backgroundAgentStore.js'
import { listBackgroundRuns } from '@server/lib/chat/backgroundAgentStore.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'

export const HUB_SSE_DEBOUNCE_MS = 75

type Subscriber = {
  workspaceHandle: string
  writeSSE: (msg: { event: string; data: string }) => Promise<void>
}

const subscribers = new Set<Subscriber>()

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingDocs = new Map<string, BackgroundRunDoc>()

/** Debounced per workspace — independent keys from `debounceTimers` (doc.id includes colons). */
const notificationDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Test hook: clear subscribers and timers */
export function resetHubSseBrokerForTests(): void {
  for (const t of debounceTimers.values()) clearTimeout(t)
  debounceTimers.clear()
  pendingDocs.clear()
  for (const t of notificationDebounceTimers.values()) clearTimeout(t)
  notificationDebounceTimers.clear()
  subscribers.clear()
}

export function workspaceHandleForBackgroundNotify(): string {
  return tryGetTenantContext()?.workspaceHandle ?? '_single'
}

/** Register one client's SSE writer; unsubscribe on connection close. */
export function registerHubSseSubscriber(
  workspaceHandle: string,
  writeSSE: (msg: { event: string; data: string }) => Promise<void>,
): () => void {
  const sub: Subscriber = { workspaceHandle, writeSSE }
  subscribers.add(sub)
  return () => {
    subscribers.delete(sub)
  }
}

async function flushNotify(workspaceHandle: string, doc: BackgroundRunDoc): Promise<void> {
  const targets = [...subscribers].filter((s) => s.workspaceHandle === workspaceHandle)
  if (targets.length === 0) return

  if (doc.id === 'your-wiki' || doc.kind === 'your-wiki') {
    const data = JSON.stringify(doc)
    await Promise.allSettled(targets.map((s) => s.writeSSE({ event: 'your_wiki', data })))
    return
  }

  const agents = await listBackgroundRuns()
  const data = JSON.stringify({ agents })
  await Promise.allSettled(targets.map((s) => s.writeSSE({ event: 'background_agents', data })))
}

async function flushNotificationsChanged(workspaceHandle: string): Promise<void> {
  const targets = [...subscribers].filter((s) => s.workspaceHandle === workspaceHandle)
  if (targets.length === 0) return
  await Promise.allSettled(
    targets.map((s) => s.writeSSE({ event: 'notifications_changed', data: '{}' })),
  )
}

/**
 * Called after tenant notification rows change. Debounced per workspace so bursts (e.g. mail sync)
 * collapse to one SSE signal; clients refetch `GET /api/notifications`.
 */
export function notifyNotificationsChanged(): void {
  const ws = workspaceHandleForBackgroundNotify()
  const prev = notificationDebounceTimers.get(ws)
  if (prev !== undefined) clearTimeout(prev)
  notificationDebounceTimers.set(
    ws,
    setTimeout(() => {
      notificationDebounceTimers.delete(ws)
      void flushNotificationsChanged(ws)
    }, HUB_SSE_DEBOUNCE_MS),
  )
}

async function flushTunnelActivity(workspaceHandle: string, dataJson: string): Promise<void> {
  const targets = [...subscribers].filter((s) => s.workspaceHandle === workspaceHandle)
  if (targets.length === 0) return
  const data = dataJson.trim().length > 0 ? dataJson : '{}'
  await Promise.allSettled(targets.map((s) => s.writeSSE({ event: 'tunnel_activity', data })))
}

/** Fan-out tunnel_activity to SSE subscribers keyed by `workspaceHandle` (recipient side of cross-tenant events). */
export async function notifyBrainTunnelActivityForWorkspace(
  workspaceHandle: string | undefined | null,
  dataJson: string,
): Promise<void> {
  const ws = workspaceHandle?.trim() || ''
  await flushTunnelActivity(ws.length > 0 ? ws : '_single', dataJson)
}

export async function notifyBrainTunnelActivity(dataJson: string): Promise<void> {
  await flushTunnelActivity(workspaceHandleForBackgroundNotify(), dataJson)
}

/**
 * Called after persisting a background run doc. Debounced per `(workspace, doc.id)` so tool
 * bursts collapse to one SSE delivery.
 */
export function notifyBackgroundRunWritten(doc: BackgroundRunDoc): void {
  const ws = workspaceHandleForBackgroundNotify()
  const key = `${ws}:${doc.id}`
  pendingDocs.set(key, doc)

  const prev = debounceTimers.get(key)
  if (prev !== undefined) clearTimeout(prev)

  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key)
      const d = pendingDocs.get(key)
      pendingDocs.delete(key)
      if (d) void flushNotify(ws, d)
    }, HUB_SSE_DEBOUNCE_MS),
  )
}
