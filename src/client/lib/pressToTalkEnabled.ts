/**
 * Press-and-hold voice-to-text in the chat composer (OPP-050).
 * Hardcoded off until the flow is shippable; restore gating in `pressToTalkEnabledFromMetaEnv` when ready.
 */
export function pressToTalkEnabledFromMetaEnv(_env: { readonly DEV: boolean }): boolean {
  return false
}

export function isPressToTalkEnabled(): boolean {
  return false
}
