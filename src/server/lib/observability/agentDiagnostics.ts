/**
 * Dev-only artifacts under `$BRAIN_HOME/var/agent-diagnostics/` — line-oriented **JSONL** for agent
 * turns (header + one record per `AgentEvent` + footer). Suggest-repair stays a small `.json`.
 * Only written when {@link shouldWriteAgentDiagnostics} is true (`isDevRuntime()`).
 *
 * **Invariant:** no migration of old diagnostics, no backwards compatibility readers, no dual write
 * paths. Old files under this directory are undefined — bump {@link AGENT_DIAGNOSTICS_SCHEMA_VERSION}
 * and reshape records whenever useful; callers must not preserve prior on-disk layouts.
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent, AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { LlmUsageSnapshot } from '@server/lib/llm/llmUsage.js'
import {
  countAssistantCompletionsWithUsage,
  rollupAssistantLlmIds,
  sumUsageFromMessages,
} from '@server/lib/llm/llmUsage.js'
import { truncateJsonResult } from '@server/lib/llm/truncateJson.js'
import { brainHome } from '@server/lib/platform/brainHome.js'
import { brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'
import { isDevRuntime } from '@server/lib/platform/isDevRuntime.js'
import { brainLogger } from './brainLogger.js'

/** Same predicate as bootstrap / {@link brainLogger} (`isDevRuntime()` → `NODE_ENV !== 'production'`). */export function shouldWriteAgentDiagnostics(): boolean {
  return isDevRuntime()
}

/** Bumped freely; see file comment — no compatibility with prior schema versions. */
export const AGENT_DIAGNOSTICS_SCHEMA_VERSION = 3 as const

const DIAG_SUBDIR = 'agent-diagnostics'
const MAX_REASONABLE_STRING = 48_000
const MAX_AGENT_END_PREVIEW_STRING = 120_000
const REPAIR_PREVIEW = 28_000

/** Min UTF-8 size of `result` JSON before spilling a sidecar file (inline row stays small). */
const TOOL_RESULT_SIDECAR_MIN_UTF8_BYTES = 65_536
const TOOL_TRACE_PREVIEW_CHARS = 2_000

export type AgentDiagnosticsMeta = {
  agentTurnId: string
  /** {@link import('@server/lib/llm/llmAgentKind.js').LlmAgentKind} or a loose label */
  agentKind: string
  /** e.g. chat_sse / wiki_enrich / collect_agent_prompt_metrics */
  source: string
  sessionId?: string
  backgroundRunId?: string
}

export type DiagToolTraceEntry = {
  toolCallId: string
  toolName: string
  isError: boolean
  durationMs?: number
  argsJsonBytes?: number
  resultJsonBytes?: number
  resultTruncated: boolean
  resultSha256: string
  resultPreview: string
  sidecarRef?: string
}

export type DiagHeaderLine = {
  kind: 'diag_header'
  schemaVersion: typeof AGENT_DIAGNOSTICS_SCHEMA_VERSION
  meta: AgentDiagnosticsMeta
  wallClockStarted: string
}

export type DiagEventLine = {
  kind: 'event'
  seq: number
} & Record<string, unknown>

export type DiagFooterLine = {
  kind: 'diag_footer'
  wallClockEnded: string
  summary: {
    durationMs: number
    usage: LlmUsageSnapshot
    completionCount: number
    toolCallCount: number
    provider?: string
    model?: string
  }
  toolTrace: DiagToolTraceEntry[]
  transcript: unknown
}

function agentDiagnosticsRoot(): string {
  return join(brainLayoutVarDir(brainHome()), DIAG_SUBDIR)
}

function sanitizeKindForFilename(kind: string): string {
  return kind.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)
}

function sanitizeToolCallIdForFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 48)
}

function compactIsoForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function truncateDeepString(text: string, max: number): string {
  if (text.length <= max) return text
  return truncateJsonResult(text, max)
}

function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

function jsonUtf8Bytes(value: unknown): number {
  try {
    return utf8ByteLength(JSON.stringify(value))
  } catch {
    return utf8ByteLength(String(value))
  }
}

function sha256InputFromResult(value: unknown): string {
  try {
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)
  } catch {
    return String(value)
  }
}

function resultPreviewString(value: unknown): string {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value)
    if (s.length <= TOOL_TRACE_PREVIEW_CHARS) return s
    return `${s.slice(0, TOOL_TRACE_PREVIEW_CHARS)}…`
  } catch {
    return String(value).slice(0, TOOL_TRACE_PREVIEW_CHARS)
  }
}

/** JSON-safe-ish snapshot of an event; avoids duplicating full `agent_end.messages` in the stream. */
export function serializeAgentEventForDiagnostics(ev: AgentEvent): Record<string, unknown> {
  switch (ev.type) {
    case 'agent_start':
      return { type: 'agent_start' }
    case 'agent_end': {
      const n = Array.isArray(ev.messages) ? ev.messages.length : 0
      return { type: 'agent_end', messageCount: n }
    }
    case 'turn_start':
      return { type: 'turn_start' }
    case 'turn_end':
      return truncateStringsInValue(
        {
          type: 'turn_end',
          message: ev.message,
          toolResultCount: ev.toolResults.length,
        },
        MAX_REASONABLE_STRING,
      ) as Record<string, unknown>
    case 'message_start':
    case 'message_end':
      return truncateStringsInValue({ type: ev.type, message: ev.message }, MAX_REASONABLE_STRING) as Record<
        string,
        unknown
      >
    case 'message_update':
      return truncateStringsInValue(
        {
          type: 'message_update',
          message: ev.message,
          assistantMessageEvent: ev.assistantMessageEvent,
        },
        MAX_REASONABLE_STRING,
      ) as Record<string, unknown>
    case 'tool_execution_start':
      return {
        type: 'tool_execution_start',
        toolCallId: ev.toolCallId,
        toolName: ev.toolName,
        args: truncateStringsInValue(ev.args, MAX_REASONABLE_STRING),
      }
    case 'tool_execution_update':
      return truncateStringsInValue(
        {
          type: 'tool_execution_update',
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          args: ev.args,
          partialResult: ev.partialResult,
        },
        MAX_REASONABLE_STRING,
      ) as Record<string, unknown>
    case 'tool_execution_end':
      return {
        type: 'tool_execution_end',
        toolCallId: ev.toolCallId,
        toolName: ev.toolName,
        isError: ev.isError,
        result: truncateStringsInValue(ev.result, MAX_REASONABLE_STRING),
      }
    default:
      return { type: 'unknown', note: 'unhandled AgentEvent shape' }
  }
}

function truncateStringsInValue(value: unknown, maxStr: number): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return truncateDeepString(value, maxStr)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((v) => truncateStringsInValue(v, maxStr))
  }
  const o = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o)) {
    out[k] = truncateStringsInValue(o[k], maxStr)
  }
  return out
}

function transcriptForFile(messages: AgentMessage[] | undefined): unknown {
  if (!Array.isArray(messages)) return []
  return truncateStringsInValue(messages, MAX_AGENT_END_PREVIEW_STRING)
}

function buildSummary(
  messages: AgentMessage[] | undefined,
  toolCallCount: number,
  durationMs: number,
): DiagFooterLine['summary'] {
  const usage = sumUsageFromMessages(messages)
  const completionCount = countAssistantCompletionsWithUsage(messages)
  const ids = rollupAssistantLlmIds(messages)
  return {
    durationMs,
    usage,
    completionCount,
    toolCallCount,
    ...ids,
  }
}

function shouldOmitEventLine(ev: AgentEvent): boolean {
  return ev.type === 'message_update' || ev.type === 'tool_execution_update'
}

async function writeAgentDiagnosticsJsonl(
  diagnosticsDir: string,
  fileStem: string,
  lines: string[],
): Promise<string> {
  await mkdir(diagnosticsDir, { recursive: true })
  const path = join(diagnosticsDir, `${fileStem}.jsonl`)
  await writeFile(path, `${lines.join('\n')}\n`, 'utf-8')
  return path
}

type PendingToolDiag = {
  startedAt: number
  argsJsonBytes: number
}

/**
 * Second subscriber on the same Agent; writes **JSONL** (header + one line per `AgentEvent` + footer) on `agent_end`.
 * Omits `message_update` / `tool_execution_update` lines. No-op when not dev. Returns unsubscribe to pair with the primary stream handler.
 */
export function attachAgentDiagnosticsCollector(agent: Agent, meta: AgentDiagnosticsMeta): () => void {
  if (!shouldWriteAgentDiagnostics()) {
    return () => {}
  }
  const diagnosticsDir = agentDiagnosticsRoot()
  const shortId = meta.agentTurnId.slice(0, 8)
  const fileStem = `${compactIsoForFilename()}_${shortId}_${sanitizeKindForFilename(meta.agentKind)}`
  const wallClockStarted = new Date().toISOString()
  const startedAt = performance.now()
  let seq = 0
  let toolStartCount = 0
  const lines: string[] = []
  const pendingTools = new Map<string, PendingToolDiag>()
  const toolTrace: DiagToolTraceEntry[] = []

  const header: DiagHeaderLine = {
    kind: 'diag_header',
    schemaVersion: AGENT_DIAGNOSTICS_SCHEMA_VERSION,
    meta: { ...meta },
    wallClockStarted,
  }
  lines.push(JSON.stringify(header))

  const unsub = agent.subscribe(async (ev: AgentEvent) => {
    try {
      if (ev.type === 'tool_execution_start') {
        toolStartCount++
        pendingTools.set(ev.toolCallId, {
          startedAt: performance.now(),
          argsJsonBytes: jsonUtf8Bytes(ev.args),
        })
      }

      if (!shouldOmitEventLine(ev)) {
        if (ev.type === 'tool_execution_end') {
          const pending = pendingTools.get(ev.toolCallId)
          pendingTools.delete(ev.toolCallId)
          const durationMs =
            pending !== undefined ? Math.max(0, Math.round(performance.now() - pending.startedAt)) : undefined

          const argsJsonBytes = pending !== undefined ? pending.argsJsonBytes : undefined
          const resultJsonBytes = jsonUtf8Bytes(ev.result)
          const previewSource = resultPreviewString(ev.result)
          let displayedResult: unknown
          let resultTruncated = false
          let sidecarRef: string | undefined
          let shaInput: string

          if (resultJsonBytes >= TOOL_RESULT_SIDECAR_MIN_UTF8_BYTES) {
            sidecarRef = `${fileStem}_tool_${sanitizeToolCallIdForFilename(ev.toolCallId)}.json`
            const sidecarPayload = {
              toolCallId: ev.toolCallId,
              toolName: ev.toolName,
              isError: ev.isError,
              result: ev.result,
            }
            const sidecarBody = `${JSON.stringify(sidecarPayload, null, 2)}\n`
            await mkdir(diagnosticsDir, { recursive: true })
            await writeFile(join(diagnosticsDir, sidecarRef), sidecarBody, 'utf-8')
            displayedResult = {
              ref: sidecarRef,
              bytes: utf8ByteLength(sidecarBody),
              kind: 'diag_tool_sidecar',
            }
            shaInput = sidecarBody
          } else {
            const truncated = truncateStringsInValue(ev.result, MAX_REASONABLE_STRING)
            displayedResult = truncated
            resultTruncated = jsonUtf8Bytes(truncated) < resultJsonBytes
            shaInput = sha256InputFromResult(ev.result)
          }

          const resultSha256 = createHash('sha256').update(shaInput).digest('hex')
          toolTrace.push({
            toolCallId: ev.toolCallId,
            toolName: ev.toolName,
            isError: ev.isError,
            durationMs,
            argsJsonBytes,
            resultJsonBytes,
            resultTruncated,
            resultSha256,
            resultPreview: previewSource,
            ...(sidecarRef !== undefined ? { sidecarRef } : {}),
          })

          const row: DiagEventLine = {
            kind: 'event',
            seq: ++seq,
            type: 'tool_execution_end',
            toolCallId: ev.toolCallId,
            toolName: ev.toolName,
            isError: ev.isError,
            result: displayedResult,
          }
          lines.push(JSON.stringify(row))
        } else {
          const payload = serializeAgentEventForDiagnostics(ev)
          const row: DiagEventLine = { kind: 'event', seq: ++seq, ...payload }
          lines.push(JSON.stringify(row))
        }
      }
    } catch {
      lines.push(JSON.stringify({ kind: 'event', seq: ++seq, type: 'serialization_error' }))
    }

    if (ev.type !== 'agent_end') return

    const messages = ev.messages
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt))
    const wallClockEnded = new Date().toISOString()
    const summary = buildSummary(messages, toolStartCount, durationMs)
    const footer: DiagFooterLine = {
      kind: 'diag_footer',
      wallClockEnded,
      summary,
      toolTrace,
      transcript: transcriptForFile(messages),
    }
    lines.push(JSON.stringify(footer))
    try {
      const path = await writeAgentDiagnosticsJsonl(diagnosticsDir, fileStem, lines)
      brainLogger.info(
        {
          agentDiagnosticsFile: path,
          agentTurnId: meta.agentTurnId,
          agentKind: meta.agentKind,
          source: meta.source,
          ...(meta.sessionId !== undefined ? { sessionId: meta.sessionId } : {}),
          ...(meta.backgroundRunId !== undefined ? { backgroundRunId: meta.backgroundRunId } : {}),
        },
        'agent-diagnostics-written',
      )
    } catch (e) {
      brainLogger.warn({ err: e, agentTurnId: meta.agentTurnId }, 'agent-diagnostics-write-failed')
    }
  })
  return unsub
}

/**
 * Dev JSONL for turns that **do not** run through pi-agent `subscribe` (shortcuts, synthetic traces, etc.).
 * Callers own `meta`, `toolTrace`, and an arbitrary JSON `transcript`; strings in `transcript` are truncated on write.
 */
export type SyntheticTurnDiagnosticsArgs = {
  meta: AgentDiagnosticsMeta
  /** Filename segment after timestamp and short agent id (sanitized). */
  fileKind: string
  durationMs: number
  toolTrace: DiagToolTraceEntry[]
  transcript: unknown
  /** Optional middle rows (each JSON-serialized); use `kind: 'event'` lines to match Agent stream dumps. */
  events?: unknown[]
}

export async function writeSyntheticTurnDiagnosticsJsonl(
  args: SyntheticTurnDiagnosticsArgs,
): Promise<string | null> {
  if (!shouldWriteAgentDiagnostics()) return null
  const diagnosticsDir = agentDiagnosticsRoot()
  const shortId = args.meta.agentTurnId.slice(0, 8)
  const fileStem = `${compactIsoForFilename()}_${shortId}_${sanitizeKindForFilename(args.fileKind)}`
  const wallClockStarted = new Date().toISOString()
  const summary = buildSummary(undefined, args.toolTrace.length, args.durationMs)
  const footer: DiagFooterLine = {
    kind: 'diag_footer',
    wallClockEnded: new Date().toISOString(),
    summary,
    toolTrace: args.toolTrace,
    transcript: truncateStringsInValue(args.transcript, MAX_REASONABLE_STRING),
  }
  const header: DiagHeaderLine = {
    kind: 'diag_header',
    schemaVersion: AGENT_DIAGNOSTICS_SCHEMA_VERSION,
    meta: { ...args.meta },
    wallClockStarted,
  }
  const lines = [JSON.stringify(header)]
  if (args.events?.length) {
    for (const ev of args.events) lines.push(JSON.stringify(ev))
  }
  lines.push(JSON.stringify(footer))
  try {
    const path = await writeAgentDiagnosticsJsonl(diagnosticsDir, fileStem, lines)
    brainLogger.info(
      {
        agentDiagnosticsFile: path,
        agentTurnId: args.meta.agentTurnId,
        agentKind: args.meta.agentKind,
        source: args.meta.source,
        ...(args.meta.sessionId !== undefined ? { sessionId: args.meta.sessionId } : {}),
        ...(args.meta.backgroundRunId !== undefined ? { backgroundRunId: args.meta.backgroundRunId } : {}),
      },
      'agent-diagnostics-written',
    )
    return path
  } catch (e) {
    brainLogger.warn({ err: e, agentTurnId: args.meta.agentTurnId }, 'agent-diagnostics-write-failed')
    return null
  }
}

export type SuggestReplyRepairDiagnosticsArgs = {
  parentAgentTurnId: string
  sessionId?: string
  provider: string
  modelId: string
  systemPrompt: string
  userBody: string
  usage: LlmUsageSnapshot
  durationMs: number
  outcome: 'completeSimple' | 'fallback' | 'error'
  errorMessage?: string
}

/**
 * Smaller artifact for the non-Agent `completeSimple` repair pass; links to the main turn via `parentAgentTurnId`.
 */
export async function writeSuggestReplyRepairDiagnostics(args: SuggestReplyRepairDiagnosticsArgs): Promise<string | null> {
  if (!shouldWriteAgentDiagnostics()) return null
  const dir = agentDiagnosticsRoot()
  try {
    await mkdir(dir, { recursive: true })
    const shortId = args.parentAgentTurnId.slice(0, 8)
    const name = `${compactIsoForFilename()}_${shortId}_suggest_reply_repair.json`
    const path = join(dir, name)
    const payload = {
      schemaVersion: AGENT_DIAGNOSTICS_SCHEMA_VERSION,
      kind: 'suggest_reply_repair' as const,
      writtenAt: new Date().toISOString(),
      parentAgentTurnId: args.parentAgentTurnId,
      ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
      provider: args.provider,
      modelId: args.modelId,
      durationMs: args.durationMs,
      outcome: args.outcome,
      ...(args.errorMessage !== undefined ? { errorMessage: args.errorMessage } : {}),
      usage: args.usage,
      systemPromptPreview: truncateDeepString(args.systemPrompt, REPAIR_PREVIEW),
      userBodyPreview: truncateDeepString(args.userBody, REPAIR_PREVIEW),
    }
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
    brainLogger.info(
      {
        agentDiagnosticsFile: path,
        agentTurnId: args.parentAgentTurnId,
        agentKind: 'suggest_reply_repair',
        source: 'suggest_reply_repair',
        ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
      },
      'agent-diagnostics-written',
    )
    return path
  } catch (e) {
    brainLogger.warn({ err: e, agentTurnId: args.parentAgentTurnId }, 'agent-diagnostics-write-failed')
    return null
  }
}
