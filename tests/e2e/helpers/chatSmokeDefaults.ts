/** Timeouts shared by assistant-chat e2e specs (see `assistant-chat-smoke.spec.ts`). */
export const CHAT_SMOKE_TIMEOUTS = {
  testTimeoutMs: 45_000,
  uiTimeoutMs: 8_000,
  chatPostTimeoutMs: 15_000,
  assistantAnswerTimeoutMs: 22_000,
} as const

/** Enron multi-tenant flows (grant directory, collaborator tools, multi-phase browser contexts). */
export const ENRON_B2B_AGENT_TIMEOUTS = {
  testTimeoutMs: 180_000,
  uiTimeoutMs: 20_000,
  chatPostTimeoutMs: 35_000,
  assistantAnswerTimeoutMs: 75_000,
} as const

export function createStepLogger(prefix: string): {
  logStep(msg: string, extra?: unknown): void
  reset(): void
} {
  let step = 0
  return {
    logStep(msg: string, extra?: unknown): void {
      const label = `[${prefix}][${++step}] ${msg}`
      if (extra === undefined) {
        console.log(label)
        return
      }
      console.log(label, extra)
    },
    reset(): void {
      step = 0
    },
  }
}
