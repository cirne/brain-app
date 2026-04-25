/**
 * Press-and-hold voice-to-text in the chat composer (OPP-050).
 * Enabled only under the Vite dev server; production client builds hide the UI.
 */
export function pressToTalkEnabledFromMetaEnv(env: { readonly DEV: boolean }): boolean {
  return env.DEV === true
}

export function isPressToTalkEnabled(): boolean {
  return pressToTalkEnabledFromMetaEnv(import.meta.env)
}
