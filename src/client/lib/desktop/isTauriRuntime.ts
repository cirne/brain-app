/** True when the UI runs inside the Braintunnel Tauri shell (desktop). */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
