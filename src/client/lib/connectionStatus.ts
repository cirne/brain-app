import { writable, type Writable } from 'svelte/store'

export type ConnectionState = 'connected' | 'session-expired' | 'server-unavailable'

const DEBOUNCE_MS = 400
const RECURRING_PROBE_MS = 30_000

export const connectionStatus: Writable<ConnectionState> = writable('connected')

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let recurringTimer: ReturnType<typeof setInterval> | null = null

function clearDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function clearRecurring(): void {
  if (recurringTimer !== null) {
    clearInterval(recurringTimer)
    recurringTimer = null
  }
}

function ensureRecurringProbe(): void {
  if (recurringTimer !== null) return
  recurringTimer = setInterval(() => {
    void runVaultProbe()
  }, RECURRING_PROBE_MS)
}

async function interpretProbeResponse(res: Response): Promise<void> {
  if (!res.ok) {
    connectionStatus.set('server-unavailable')
    ensureRecurringProbe()
    return
  }
  let data: { unlocked?: boolean }
  try {
    data = (await res.json()) as { unlocked?: boolean }
  } catch {
    connectionStatus.set('server-unavailable')
    ensureRecurringProbe()
    return
  }
  if (data.unlocked === false) {
    clearRecurring()
    connectionStatus.set('session-expired')
    return
  }
  clearRecurring()
  connectionStatus.set('connected')
}

/** Single probe used by debounced notifications, manual retry, and recurring timer. */
export async function runVaultProbe(): Promise<void> {
  try {
    const res = await fetch('/api/vault/status', { credentials: 'include' })
    await interpretProbeResponse(res)
  } catch {
    connectionStatus.set('server-unavailable')
    ensureRecurringProbe()
  }
}

/**
 * SSE or other channel reports the transport is healthy again — clear overlays without waiting for probe.
 */
export function notifyConnected(): void {
  clearDebounce()
  clearRecurring()
  connectionStatus.set('connected')
}

/**
 * A fetch failed or SSE errored — debounce then classify via vault status (public endpoint).
 */
export function notifyPossibleConnectionIssue(): void {
  clearDebounce()
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runVaultProbe()
  }, DEBOUNCE_MS)
}

/** User tapped Retry on the connection overlay — probe immediately. */
export function probeConnectionImmediately(): void {
  clearDebounce()
  void runVaultProbe()
}

/** Vitest / hub mock isolation — resets timers and store. */
export function resetConnectionStatusForTests(): void {
  clearDebounce()
  clearRecurring()
  connectionStatus.set('connected')
}
