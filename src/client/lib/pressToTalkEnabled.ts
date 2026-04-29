/**
 * Tap-to-talk voice input in chat (OPP-050 / OPP-055).
 * Revert to dev-only: `return env.DEV` in pressToTalkEnabledFromMetaEnv.
 */
export function pressToTalkEnabledFromMetaEnv(env: { readonly DEV: boolean }): boolean {
  void env
  return true
}

export function isPressToTalkEnabled(): boolean {
  return pressToTalkEnabledFromMetaEnv(import.meta.env)
}
