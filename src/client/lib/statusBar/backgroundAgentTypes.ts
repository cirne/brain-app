/** Mirrors server `LogEntry`. */
export type LogEntry = { verb: string; detail: string }

/** Mirrors server `BackgroundTimelineEvent` — completed tools for the inspector feed. */
export type BackgroundTimelineEvent = {
  at: string
  kind: 'tool'
  toolName: string
  args?: Record<string, unknown> | null
  result?: string
  details?: unknown
  isError?: boolean
}

/** Mirrors server `YourWikiPhase`. */
export type YourWikiPhase = 'starting' | 'enriching' | 'cleaning' | 'paused' | 'idle' | 'error'

/** Mirrors server `LlmUsageSnapshot` — keep in sync with `src/server/lib/llmUsage.ts`. */
export type LlmUsageSnapshot = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  costTotal: number
}

/** Mirrors server `BackgroundRunDoc` for `/api/your-wiki` and `/api/background/agents`. */
export type BackgroundAgentDoc = {
  id: string
  kind: string
  status: string
  label: string
  detail: string
  pageCount: number
  lastWikiPath?: string | null
  logLines: string[]
  logEntries?: LogEntry[]
  timeline?: BackgroundTimelineEvent[]
  startedAt: string
  updatedAt: string
  error?: string
  /** Your Wiki supervisor phase */
  phase?: YourWikiPhase
  /** Your Wiki supervisor lap number (1-based) */
  lap?: number
  /** ISO timestamp when the loop went idle */
  idleSince?: string
  /** Human-readable reason for idle state */
  idleReason?: string
  /** Consecutive no-op laps */
  consecutiveNoOpLaps?: number
  usageLastInvocation?: LlmUsageSnapshot
  usageCumulative?: LlmUsageSnapshot
}
