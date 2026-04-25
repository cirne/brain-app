/**
 * POST /api/transcribe (composer press-to-talk) is dev-only until the flow is stable (OPP-050).
 * Packaged app and typical hosted staging use NODE_ENV=production.
 */
export function isTranscribeHttpAllowed(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== 'production'
}
