/**
 * Tap-to-talk voice input in chat (archived OPP-074 dev guardrail history / OPP-055 UX).
 * Revert to dev-only: `return env.DEV` in pressToTalkEnabledFromMetaEnv.
 */
export function pressToTalkEnabledFromMetaEnv(env: { readonly DEV: boolean }): boolean {
  void env
  return true
}

export function isPressToTalkEnabled(): boolean {
  return pressToTalkEnabledFromMetaEnv(import.meta.env)
}
