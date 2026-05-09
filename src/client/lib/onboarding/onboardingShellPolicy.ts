/**
 * States handled by the dedicated first-run surface in {@link App} (handle, mail connect, indexing).
 * Main {@link Assistant} mounts for `onboarding-agent` (chat bootstrap) and `done`.
 */
export const DEDICATED_ONBOARDING_STATES = ['not-started', 'confirming-handle', 'indexing'] as const

export function needsDedicatedOnboardingSurface(state: string): boolean {
  return (DEDICATED_ONBOARDING_STATES as readonly string[]).includes(state)
}
