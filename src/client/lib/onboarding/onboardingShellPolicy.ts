/**
 * States handled by the dedicated first-run surface in {@link App} (handle, mail connect, indexing).
 * Main {@link Assistant} mounts for `onboarding-agent` (chat bootstrap) and `done`.
 */
export const DEDICATED_ONBOARDING_STATES = ['not-started', 'confirming-handle', 'indexing'] as const

export function needsDedicatedOnboardingSurface(state: string): boolean {
  return (DEDICATED_ONBOARDING_STATES as readonly string[]).includes(state)
}

/**
 * Whether the client may auto-fire {@link AgentChat.sendInitialBootstrapKickoff} on an empty chat.
 * After the first bootstrap POST, the server persists `initialBootstrapSessionId`; fresh pending sessions
 * (new chat or full reload on bare `/c`) must not start another kickoff or the UI adds an empty assistant row.
 */
export function shouldAutoKickInitialBootstrap(serverInitialBootstrapSessionId: string | null): boolean {
  return serverInitialBootstrapSessionId === null
}
