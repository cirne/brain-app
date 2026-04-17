/**
 * Default HTTP port range when Brain runs as the bundled Tauri native app.
 * Port is chosen at startup from this list (not via `process.env.PORT`).
 *
 * Must stay in sync with `desktop/src/native_port.rs`.
 */
export const NATIVE_APP_PORT_START = 18473
export const NATIVE_APP_PORT_END = 18522

/**
 * Number of additional ports to try when the primary port is in use.
 * Each macOS user running Brain occupies one port, so 3 failovers supports
 * up to 4 simultaneous users on the same machine.
 * Each port must be registered as an Authorized redirect URI in Google Cloud Console.
 */
export const NATIVE_APP_PORT_FAILOVER_COUNT = 3

/** IANA: TCP 18516 is reserved in this band — omit from the scan. */
const NATIVE_APP_PORT_SKIP = 18516

/** Ordered candidates from {@link NATIVE_APP_PORT_START} through {@link NATIVE_APP_PORT_END}, skipping {@link NATIVE_APP_PORT_SKIP}. */
export function nativeAppPortCandidates(): number[] {
  const out: number[] = []
  for (let p = NATIVE_APP_PORT_START; p <= NATIVE_APP_PORT_END; p++) {
    if (p === NATIVE_APP_PORT_SKIP) continue
    out.push(p)
  }
  return out
}

/**
 * The subset of port candidates tried at startup: primary + up to
 * {@link NATIVE_APP_PORT_FAILOVER_COUNT} failovers.
 * These are the ports that must be registered as OAuth redirect URIs.
 */
export function nativeAppOAuthPortCandidates(): number[] {
  return nativeAppPortCandidates().slice(0, NATIVE_APP_PORT_FAILOVER_COUNT + 1)
}

export function isBundledNativeServer(): boolean {
  return process.env.BRAIN_BUNDLED_NATIVE === '1'
}
