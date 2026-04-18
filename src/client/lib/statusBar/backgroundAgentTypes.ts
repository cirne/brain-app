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

/** Mirrors server `BackgroundRunDoc` for `/api/background/agents`. */
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
}
