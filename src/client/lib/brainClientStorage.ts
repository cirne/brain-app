/**
 * Query flag: server GET `/reset` redirects here so the SPA clears origin storage once (dev soft reset).
 * @see clearOriginStorageDevReset
 */
export const DEV_CLIENT_RESET_QUERY_PARAM = 'devClientReset'
export const DEV_CLIENT_RESET_QUERY_VALUE = '1'

/**
 * Remove every localStorage and sessionStorage key starting with `brain-` (legacy narrow clear).
 * Prefer {@link clearOriginStorageDevReset} for dev soft reset so `brain.*` prefs are wiped too.
 */
export function clearBrainClientStorage(): void {
  if (typeof localStorage !== 'undefined') {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('brain-')) keys.push(k)
    }
    for (const k of keys) {
      try {
        localStorage.removeItem(k)
      } catch {
        /* ignore */
      }
    }
  }
  if (typeof sessionStorage !== 'undefined') {
    const keys: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k?.startsWith('brain-')) keys.push(k)
    }
    for (const k of keys) {
      try {
        sessionStorage.removeItem(k)
      } catch {
        /* ignore */
      }
    }
  }
}

/** Dev soft reset: wipe all keys for this origin (local + session). */
export function clearOriginStorageDevReset(): void {
  try {
    localStorage?.clear()
  } catch {
    /* ignore */
  }
  try {
    sessionStorage?.clear()
  } catch {
    /* ignore */
  }
}
