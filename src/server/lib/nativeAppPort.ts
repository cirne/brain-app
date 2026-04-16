/**
 * Default HTTP port range when Brain runs as the bundled Tauri native app.
 * Port is chosen at startup from this list (not via `process.env.PORT`).
 *
 * Must stay in sync with `desktop/src/native_port.rs`.
 */
export const NATIVE_APP_PORT_START = 18473
export const NATIVE_APP_PORT_END = 18522

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

export function isBundledNativeServer(): boolean {
  return process.env.BRAIN_BUNDLED_NATIVE === '1'
}
