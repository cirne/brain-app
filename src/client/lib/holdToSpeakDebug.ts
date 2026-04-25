/**
 * Opt-in hold-to-speak tracing (Safari / BUG-023). No remote ingest.
 * Enable: URL `?holdSpeakDebug=1` or `localStorage.brain_hold_speak_debug=1`
 */
const STORAGE_KEY = 'brain_hold_speak_debug'

function queryFlag(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    return new URLSearchParams(window.location.search).get('holdSpeakDebug') === '1'
  } catch {
    return false
  }
}

function storageFlag(): boolean {
  const ls = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined
  if (ls == null) {
    return false
  }
  try {
    return ls.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function isHoldToSpeakDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return queryFlag() || storageFlag()
}

export function logHoldToSpeakDebug(event: string, data?: Record<string, unknown>): void {
  if (!isHoldToSpeakDebugEnabled()) {
    return
  }
  const line = { t: 'hold_speak', event, ...data, ts: Date.now() }
  const c = globalThis.console
  if (typeof c?.debug === 'function') {
    c.debug('[holdSpeakDebug]', line)
  }
}
