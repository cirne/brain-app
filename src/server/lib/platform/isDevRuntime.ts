/**
 * Whether the Node server is running in **development mode** relative to production bundles.
 *
 * Same predicate as {@link ../../index.ts}: `process.env.NODE_ENV !== 'production'` (covers
 * `development`, `test`, and undefined). Used for dev-only routes, pretty logging, prompt
 * reload, and agent diagnostics.
 */
export function isDevRuntime(): boolean {
  return process.env.NODE_ENV !== 'production'
}
