export type WaitUntilDefinedOptions<T> = {
  get: () => T | undefined
  tick: () => Promise<void>
  /** @default 16 */
  maxIterations?: number
  shouldAbort?: () => boolean
}

/**
 * Matches Assistant’s “wait for bind:this AgentChat” loops: `await tick()` first, then optional
 * `shouldAbort`, then read the ref with `get()`.
 */
export async function waitUntilDefinedOrMaxTicks<T>(
  options: WaitUntilDefinedOptions<T>,
): Promise<T | undefined> {
  const max = options.maxIterations ?? 16
  for (let i = 0; i < max; i++) {
    await options.tick()
    if (options.shouldAbort?.()) return undefined
    const v = options.get()
    if (v) return v
  }
  return undefined
}
