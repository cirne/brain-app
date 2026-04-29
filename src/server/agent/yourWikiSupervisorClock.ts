/**
 * Injectable timers for {@link ../agent/yourWikiSupervisor.js} tests and alternative runtimes.
 */
export type WikiSupervisorClock = {
  setTimeout: typeof globalThis.setTimeout
  clearTimeout: typeof globalThis.clearTimeout
}

const defaultClock: WikiSupervisorClock = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
}

let clockOverride: WikiSupervisorClock | null = null

export function getWikiSupervisorClock(): WikiSupervisorClock {
  return clockOverride ?? defaultClock
}

/** Test-only: restore with {@link resetWikiSupervisorClockForTests}. */
export function setWikiSupervisorClockForTests(c: WikiSupervisorClock | null): void {
  clockOverride = c
}

export function resetWikiSupervisorClockForTests(): void {
  clockOverride = null
}
