import newrelic from 'newrelic'
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

export type RecordToolCallEndOptions = {
  toolCallId: string
  toolName: string
  args: unknown
  isError?: boolean
  source: ToolCallSource
  correlation?: ToolCallCorrelation
  errorMessage?: string
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

    safeRecordCustomEvent('ToolCall', attrs)
  } catch {
    /* ignore */
  }
}
