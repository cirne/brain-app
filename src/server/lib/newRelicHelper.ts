import type { AgentMessage } from '@mariozechner/pi-agent-core'
import newrelic from 'newrelic'
import type { LlmUsageSnapshot } from './llmUsage.js'
import { tryGetTenantContext } from './tenantContext.js'

const PARAMS_JSON_MAX = 4096
const ERROR_MESSAGE_MAX = 500
const MAX_START_MAP = 500
const SANITIZE_MAX_DEPTH = 8
const STRING_VALUE_MAX = 2000
const ARRAY_MAX_ITEMS = 50

const REDACT_KEY_MARKERS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'bearer',
]

/** Mirrors {@link newrelic.cjs}: agent off when no license key. */
export function isAgentEnabled(): boolean {
  return Boolean(process.env.NEW_RELIC_LICENSE_KEY?.trim())
}

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase()
  return REDACT_KEY_MARKERS.some((m) => lower.includes(m))
}

function sanitizeValue(depth: number, value: unknown, maxDepth: number): unknown {
  if (depth > maxDepth) return '[max depth]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > STRING_VALUE_MAX ? `${value.slice(0, STRING_VALUE_MAX)}…` : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const slice = value.slice(0, ARRAY_MAX_ITEMS).map((v) => sanitizeValue(depth + 1, v, maxDepth))
    return slice.length < value.length ? [...slice, '…'] : slice
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = shouldRedactKey(k) ? '[redacted]' : sanitizeValue(depth + 1, v, maxDepth)
    }
    return out
  }
  return String(value).slice(0, 500)
}

/** Deep-redact + stringify for custom event attributes (bounded size). */
export function sanitizeForNewRelicJson(value: unknown, options?: { maxDepth?: number }): string {
  const maxDepth = options?.maxDepth ?? SANITIZE_MAX_DEPTH
  try {
    const sanitized = sanitizeValue(0, value, maxDepth)
    let s = JSON.stringify(sanitized)
    if (s.length > PARAMS_JSON_MAX) {
      s = `${s.slice(0, PARAMS_JSON_MAX)}…`
    }
    return s
  } catch {
    try {
      const fallback = JSON.stringify(String(value))
      return fallback.length > PARAMS_JSON_MAX ? `${fallback.slice(0, PARAMS_JSON_MAX)}…` : fallback
    } catch {
      return '{}'
    }
  }
}

export function safeRecordCustomEvent(
  type: string,
  attributes: Record<string, string | number | boolean>,
): void {
  if (!isAgentEnabled()) return
  try {
    newrelic.recordCustomEvent(type, attributes)
  } catch {
    /* never throw into app paths */
  }
}

export type ToolCallSource = 'chat' | 'wikiExpansion' | 'wikiCleanup'

export type ToolCallCorrelation = {
  sessionId?: string
  workspaceHandle?: string
  backgroundRunId?: string
}

/** Explicit correlation wins; fills `workspaceHandle` from tenant ALS when missing. */
export function mergeToolCallCorrelation(explicit?: ToolCallCorrelation): ToolCallCorrelation {
  const out: ToolCallCorrelation = { ...explicit }
  const tenant = tryGetTenantContext()
  if (!out.workspaceHandle && tenant?.workspaceHandle) {
    out.workspaceHandle = tenant.workspaceHandle
  }
  return out
}

/** Bounded bucket for tool result size (post-SSE truncation); low cardinality for NR. */
export type ResultSizeBucket = '0-1k' | '1k-8k' | '8k+'

export function resultSizeBucketFromCharCount(n: number): ResultSizeBucket {
  if (n < 1024) return '0-1k'
  if (n < 8192) return '1k-8k'
  return '8k+'
}

export type RecordToolCallEndOptions = {
  toolCallId: string
  toolName: string
  args: unknown
  isError?: boolean
  source: ToolCallSource
  correlation?: ToolCallCorrelation
  errorMessage?: string
  /** One `agent.prompt()` / subscribe scope — correlates ToolCall, LlmCompletion, LlmAgentTurn. */
  agentTurnId?: string
  /** 0-based order of completed tools within the turn. */
  sequence?: number
  /**
   * Length of the string after `toolResultForSse` (what the client stream shows / proxy for
   * next-context bloat). Never the raw pre-truncation body alone.
   */
  resultCharCount?: number
  resultTruncated?: boolean
  resultSizeBucket?: ResultSizeBucket
}

const toolCallStartTimes = new Map<string, number>()

export function recordToolCallStart(toolCallId: string): void {
  if (!isAgentEnabled()) return
  if (toolCallStartTimes.size >= MAX_START_MAP) {
    toolCallStartTimes.clear()
  }
  toolCallStartTimes.set(toolCallId, performance.now())
}

export function recordToolCallEnd(options: RecordToolCallEndOptions): void {
  if (!isAgentEnabled()) return
  try {
    const merged = mergeToolCallCorrelation(options.correlation)
    const start = toolCallStartTimes.get(options.toolCallId)
    toolCallStartTimes.delete(options.toolCallId)
    const durationMs =
      start !== undefined ? Math.max(0, Math.round(performance.now() - start)) : 0

    const paramsJson = sanitizeForNewRelicJson(options.args)
    let errMsg = options.errorMessage
    if (!errMsg && options.isError) {
      errMsg = 'tool_error'
    }
    if (errMsg && errMsg.length > ERROR_MESSAGE_MAX) {
      errMsg = errMsg.slice(0, ERROR_MESSAGE_MAX)
    }

    const attrs: Record<string, string | number | boolean> = {
      toolName: options.toolName,
      success: !options.isError,
      durationMs,
      source: options.source,
      paramsJson,
    }
    if (errMsg) attrs.errorMessage = errMsg
    if (merged.sessionId) attrs.sessionId = merged.sessionId
    if (merged.workspaceHandle) attrs.workspaceHandle = merged.workspaceHandle
    if (merged.backgroundRunId) attrs.backgroundRunId = merged.backgroundRunId
    attrs.toolCallId = options.toolCallId
    if (options.agentTurnId) attrs.agentTurnId = options.agentTurnId
    if (options.sequence !== undefined) attrs.sequence = options.sequence
    if (options.resultCharCount !== undefined) attrs.resultCharCount = options.resultCharCount
    if (options.resultTruncated !== undefined) attrs.resultTruncated = options.resultTruncated
    if (options.resultSizeBucket) attrs.resultSizeBucket = options.resultSizeBucket

    safeRecordCustomEvent('ToolCall', attrs)
  } catch {
    /* ignore */
  }
}

export type RecordLlmAgentTurnOptions = {
  agentTurnId: string
  source: ToolCallSource
  correlation?: ToolCallCorrelation
  usage: LlmUsageSnapshot
  turnDurationMs: number
  /** Assistant completions that reported `usage` in this turn. */
  completionCount: number
  toolCallCount: number
}

/** One LlmCompletion per model HTTP completion (assistant message with usage). */
export function recordLlmCompletionsForTurn(options: {
  agentTurnId: string
  source: ToolCallSource
  correlation?: ToolCallCorrelation
  messages: AgentMessage[] | null | undefined
}): void {
  if (!isAgentEnabled()) return
  const list = options.messages
  if (!Array.isArray(list)) return
  let completionIndex = 0
  for (const m of list) {
    if (m.role !== 'assistant') continue
    const u = m.usage
    if (u == null) continue
    const merged = mergeToolCallCorrelation(options.correlation)
    const costTotal = u.cost && typeof u.cost.total === 'number' ? u.cost.total : 0
    const attrs: Record<string, string | number | boolean> = {
      agentTurnId: options.agentTurnId,
      source: options.source,
      completionIndex,
      input: u.input,
      output: u.output,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
      totalTokens: u.totalTokens,
      costTotal,
    }
    if (merged.sessionId) attrs.sessionId = merged.sessionId
    if (merged.workspaceHandle) attrs.workspaceHandle = merged.workspaceHandle
    if (merged.backgroundRunId) attrs.backgroundRunId = merged.backgroundRunId
    safeRecordCustomEvent('LlmCompletion', attrs)
    completionIndex++
  }
}

export function recordLlmAgentTurn(options: RecordLlmAgentTurnOptions): void {
  if (!isAgentEnabled()) return
  const merged = mergeToolCallCorrelation(options.correlation)
  const u = options.usage
  const attrs: Record<string, string | number | boolean> = {
    agentTurnId: options.agentTurnId,
    source: options.source,
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    totalTokens: u.totalTokens,
    costTotal: u.costTotal,
    turnDurationMs: options.turnDurationMs,
    completionCount: options.completionCount,
    toolCallCount: options.toolCallCount,
  }
  if (merged.sessionId) attrs.sessionId = merged.sessionId
  if (merged.workspaceHandle) attrs.workspaceHandle = merged.workspaceHandle
  if (merged.backgroundRunId) attrs.backgroundRunId = merged.backgroundRunId
  safeRecordCustomEvent('LlmAgentTurn', attrs)
}
