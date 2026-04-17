/**
 * Remove every localStorage and sessionStorage key starting with `brain-` (dev hard-reset).
 * Future Brain keys are cleared without maintaining a hardcoded list.
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
