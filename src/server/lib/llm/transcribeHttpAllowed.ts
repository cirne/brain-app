/**
 * POST /api/transcribe (composer press-to-talk).
 * Revert to dev-only: `return nodeEnv !== 'production'`.
 */
export function isTranscribeHttpAllowed(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  void nodeEnv
  return true
}
