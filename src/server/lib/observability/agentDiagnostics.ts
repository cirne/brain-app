/**
 * Dev-only artifacts under `$BRAIN_HOME/var/agent-diagnostics/` — line-oriented **JSONL** for agent
 * turns (header + one record per `AgentEvent` + footer). Suggest-repair stays a small `.json`.
 * Only written when {@link shouldWriteAgentDiagnostics} is true (`isDevRuntime()`).
 *
 * **Invariant:** no migration of old diagnostics, no backwards compatibility readers, no dual write
 * paths. Old files under this directory are undefined — bump {@link AGENT_DIAGNOSTICS_SCHEMA_VERSION}
 * and reshape records whenever useful; callers must not preserve prior on-disk layouts.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent, AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core'
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
import { logger } from './logger.js'

/** Same predicate as bootstrap / logger (`isDevRuntime()` → `NODE_ENV !== 'production'`). */
export function shouldWriteAgentDiagnostics(): boolean {
  return isDevRuntime()
}

/** Bumped freely; see file comment — no compatibility with prior schema versions. */
export const AGENT_DIAGNOSTICS_SCHEMA_VERSION = 2 as const

const DIAG_SUBDIR = 'agent-diagnostics'
const MAX_REASONABLE_STRING = 48_000
const MAX_AGENT_END_PREVIEW_STRING = 120_000
const REPAIR_PREVIEW = 28_000

export type AgentDiagnosticsMeta = {
  agentTurnId: string
  /** {@link import('@server/lib/llm/llmAgentKind.js').LlmAgentKind} or a loose label */
  agentKind: string
  /** e.g. chat_sse / wiki_enrich / collect_agent_prompt_metrics */
  source: string
  sessionId?: string
  backgroundRunId?: string
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
  transcript: unknown
}

function agentDiagnosticsRoot(): string {
  return join(brainLayoutVarDir(brainHome()), DIAG_SUBDIR)
}

function sanitizeKindForFilename(kind: string): string {
  return kind.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)
}

function compactIsoForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function truncateDeepString(text: string, max: number): string {
  if (text.length <= max) return text
  return truncateJsonResult(text, max)
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

async function writeAgentDiagnosticsJsonl(
  meta: AgentDiagnosticsMeta,
  lines: string[],
): Promise<string> {
  const dir = agentDiagnosticsRoot()
  await mkdir(dir, { recursive: true })
  const shortId = meta.agentTurnId.slice(0, 8)
  const name = `${compactIsoForFilename()}_${shortId}_${sanitizeKindForFilename(meta.agentKind)}.jsonl`
  const path = join(dir, name)
  await writeFile(path, `${lines.join('\n')}\n`, 'utf-8')
  return path
}

/**
 * Second subscriber on the same Agent; writes **JSONL** (header + one line per event + footer) on `agent_end`.
 * No-op when not dev. Returns unsubscribe to pair with the primary stream handler.
 */
export function attachAgentDiagnosticsCollector(agent: Agent, meta: AgentDiagnosticsMeta): () => void {
  if (!shouldWriteAgentDiagnostics()) {
    return () => {}
  }
  const wallClockStarted = new Date().toISOString()
  const startedAt = performance.now()
  let seq = 0
  let toolStartCount = 0
  const lines: string[] = []

  const header: DiagHeaderLine = {
    kind: 'diag_header',
    schemaVersion: AGENT_DIAGNOSTICS_SCHEMA_VERSION,
    meta: { ...meta },
    wallClockStarted,
  }
  lines.push(JSON.stringify(header))

  const unsub = agent.subscribe(async (ev: AgentEvent) => {
    try {
      if (ev.type === 'tool_execution_start') toolStartCount++
      const payload = serializeAgentEventForDiagnostics(ev)
      const row: DiagEventLine = { kind: 'event', seq: ++seq, ...payload }
      lines.push(JSON.stringify(row))
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
      transcript: transcriptForFile(messages),
    }
    lines.push(JSON.stringify(footer))
    try {
      const path = await writeAgentDiagnosticsJsonl(meta, lines)
      logger.info(
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
      logger.warn({ err: e, agentTurnId: meta.agentTurnId }, 'agent-diagnostics-write-failed')
    }
  })
  return unsub
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
    logger.info(
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
    logger.warn({ err: e, agentTurnId: args.parentAgentTurnId }, 'agent-diagnostics-write-failed')
    return null
  }
}
