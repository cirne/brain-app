/**
 * Tap-to-talk voice input in chat (OPP-050 / OPP-055). Dev-only until product enables STT in prod.
 */
export function pressToTalkEnabledFromMetaEnv(env: { readonly DEV: boolean }): boolean {
  return env.DEV
}

export function isPressToTalkEnabled(): boolean {
  return pressToTalkEnabledFromMetaEnv(import.meta.env)
}
