/**
 * True when this Brain process can use macOS-local integrations: Apple Mail, Messages (chat.db),
 * Calendar.app mail sources, FDA-gated paths, etc.
 *
 * False on non-macOS (e.g. Linux/Docker) and when `BRAIN_DISABLE_APPLE_LOCAL=1`.
 *
 * Non-macOS test suites may set `BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS=1` so iMessage/Mail code paths
 * stay exercisable; `BRAIN_DISABLE_APPLE_LOCAL` wins if both are set.
 */
export function isAppleLocalIntegrationEnvironment(): boolean {
  if (process.env.BRAIN_DISABLE_APPLE_LOCAL === '1') return false
  if (process.env.BRAIN_FORCE_APPLE_LOCAL_FOR_TESTS === '1') return true
  return process.platform === 'darwin'
}
