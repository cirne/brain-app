import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssistantTurnState } from './chatTypes.js'
import {
  applyTextDelta,
  applyThinkingDelta,
  applyToolArgsUpsert,
  applyToolEnd,
  applyToolStart,
  extractStreamingToolCallsFromPartialAssistant,
} from './chatTranscript.js'
import { createWikiUnifiedDiff, safeWikiRelativePath } from '@server/lib/wiki/wikiEditDiff.js'
import { writeWikiPartialFromStreamingWriteArgs } from '@server/lib/wiki/wikiStreamingPartialWrite.js'
import {
  type LlmTurnTelemetry,
  beginToolCallSegment,
  endToolCallSegmentBridge,
  recordLlmTurnEndEvents,
  recordToolCallEnd,
  recordToolCallStart,
  toolResultSseForNr,
} from '@server/lib/observability/newRelicHelper.js'
import { truncateJsonResult } from '@server/lib/llm/truncateJson.js'
import {
  isOpenAiTtsConfigured,
  openAiTtsResponseFormat,
  streamOpenAiTtsToBuffers,
} from '@server/lib/llm/openAiTts.js'
import { coerceToolResultDetailsObject } from '@server/lib/llm/coerceToolResultDetails.js'
import {
  countAssistantCompletionsWithUsage,
  rollupAssistantLlmIds,
  sumUsageFromMessages,
  type LlmUsageSnapshot,
} from '@server/lib/llm/llmUsage.js'
import { logger } from '@server/lib/observability/logger.js'
import type { LlmAgentKind } from '@server/lib/llm/llmAgentKind.js'
import type {
  MessageUpdatePayload,
  ToolExecutionEndPayload,
  ToolExecutionStartPayload,
} from './streamAgentSseTypes.js'
import { toolResultText } from './streamAgentSseTypes.js'
import { shapeReadEmailStreamDetails } from './toolStreamAdapters.js'

/** Mutable turn fields shared across subscribe handlers. */
export interface StreamAgentSseTurnRefs {
  turnTitle: string | null | undefined
  lastRunUsage: LlmUsageSnapshot | undefined
  toolCallCount: number
  /** Vault-relative wiki paths successfully mutated this turn (anchors post-turn polish). */
  touchedWikiRelPaths: Set<string>
}

export interface StreamAgentSseHandlerDeps {
  stream: { writeSSE: (args: { event: string; data: string }) => Promise<unknown> }
  wikiDirForDiffs: string
  assistantState: AssistantTurnState
  editBeforeSnapshot: Map<string, string>
  refs: StreamAgentSseTurnRefs
  onSessionTitlePersist?: (title: string) => Promise<void>
  sseMaxChars: number
  turnLlm: LlmTurnTelemetry
  turnStartedAt: number
  agentKind: LlmAgentKind
  announceSessionId?: string
}

export async function handleStreamMessageUpdate(
  payload: { type: 'message_update' } & MessageUpdatePayload,
  deps: Pick<
    StreamAgentSseHandlerDeps,
    'stream' | 'wikiDirForDiffs' | 'assistantState'
  >,
): Promise<void> {
  const e = payload.assistantMessageEvent
  if (e?.type === 'text_delta') {
    const d = typeof e.delta === 'string' ? e.delta : String(e.delta ?? '')
    applyTextDelta(deps.assistantState, d)
    await deps.stream.writeSSE({
      event: 'text_delta',
      data: JSON.stringify({ delta: d }),
    })
  } else if (e?.type === 'thinking_delta') {
    const d = typeof e.delta === 'string' ? e.delta : String(e.delta ?? '')
    applyThinkingDelta(deps.assistantState, d)
    await deps.stream.writeSSE({
      event: 'thinking',
      data: JSON.stringify({ delta: d }),
    })
  } else if (
    e?.type === 'toolcall_start' ||
    e?.type === 'toolcall_delta' ||
    e?.type === 'toolcall_end'
  ) {
    const partialMessage = payload.message
    const streamingTools = extractStreamingToolCallsFromPartialAssistant(partialMessage)
    for (const t of streamingTools) {
      if (t.name !== 'write' && t.name !== 'edit') continue
      applyToolArgsUpsert(deps.assistantState, {
        id: t.id,
        name: t.name,
        args: t.args,
        done: false,
      })
      if (t.name === 'write') {
        await writeWikiPartialFromStreamingWriteArgs(deps.wikiDirForDiffs, t.name, t.args)
      }
      await deps.stream.writeSSE({
        event: 'tool_args',
        data: JSON.stringify({
          id: t.id,
          name: t.name,
          args: t.args,
        }),
      })
    }
  }
}

export async function handleStreamToolExecutionStart(
  te: { type: 'tool_execution_start' } & ToolExecutionStartPayload,
  deps: StreamAgentSseHandlerDeps,
): Promise<void> {
  const id = te.toolCallId
  const name = te.toolName
  const args = te.args
  recordToolCallStart(id)
  beginToolCallSegment(name, id)
  applyToolStart(deps.assistantState, { id, name, args, done: false })
  if (name === 'set_chat_title' && args && typeof args === 'object' && 'title' in args) {
    const t = String((args as { title?: unknown }).title ?? '').trim().slice(0, 120)
    if (t) {
      deps.refs.turnTitle = t
      if (deps.onSessionTitlePersist) {
        try {
          await deps.onSessionTitlePersist(t)
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (name === 'edit' && args && typeof args === 'object' && 'path' in args) {
    const rel = safeWikiRelativePath(deps.wikiDirForDiffs, (args as { path: unknown }).path)
    if (rel) {
      try {
        const beforeText = await readFile(join(deps.wikiDirForDiffs, rel), 'utf-8')
        deps.editBeforeSnapshot.set(id, beforeText)
      } catch {
        deps.editBeforeSnapshot.set(id, '')
      }
    }
  }
  await deps.stream.writeSSE({
    event: 'tool_start',
    data: JSON.stringify({
      id,
      name,
      args,
    }),
  })
}

async function resolveToolEndDetails(
  ev: { type: 'tool_execution_end' } & ToolExecutionEndPayload,
  deps: StreamAgentSseHandlerDeps,
  resultText: string,
  detailsSoFar: unknown | undefined,
): Promise<unknown | undefined> {
  let details: unknown | undefined = detailsSoFar
  if (ev.toolName === 'read_mail_message') {
    const shaped = shapeReadEmailStreamDetails(resultText, ev.toolCallId, deps.assistantState)
    if (shaped !== undefined) details = shaped
  } else if (ev.toolName === 'edit') {
    const snapBefore = deps.editBeforeSnapshot.get(ev.toolCallId)
    deps.editBeforeSnapshot.delete(ev.toolCallId)
    if (!ev.isError && snapBefore !== undefined) {
      const partBefore = deps.assistantState.parts.find(
        (p) => p.type === 'tool' && p.toolCall.id === ev.toolCallId,
      ) as { type: 'tool'; toolCall: { args: unknown } } | undefined
      const argsObj = partBefore?.toolCall.args
      const pathArg =
        argsObj != null && typeof argsObj === 'object' && 'path' in argsObj
          ? (argsObj as { path: unknown }).path
          : undefined
      const rel = safeWikiRelativePath(deps.wikiDirForDiffs, pathArg)
      if (rel) {
        try {
          const afterText = await readFile(join(deps.wikiDirForDiffs, rel), 'utf-8')
          details = {
            editDiff: {
              path: rel,
              unified: createWikiUnifiedDiff(rel, snapBefore, afterText),
            },
          }
        } catch {
          /* skip */
        }
      }
    }
  }
  return details
}

/** Record wiki-relative paths for successful write/edit/move/delete_file (post-turn touch-up anchor). */
function recordWikiMutationRelPaths(
  toolName: string,
  toolArgs: unknown | undefined,
  wikiRoot: string,
  into: Set<string>,
): void {
  if (!toolArgs || typeof toolArgs !== 'object') return
  const args = toolArgs as Record<string, unknown>

  switch (toolName) {
    case 'write':
    case 'edit':
    case 'delete_file': {
      const p = args.path
      if (typeof p === 'string') {
        const rel = safeWikiRelativePath(wikiRoot, p)
        if (rel) into.add(rel)
      }
      break
    }
    case 'move_file': {
      for (const key of ['from', 'to'] as const) {
        const raw = args[key]
        if (typeof raw === 'string') {
          const rel = safeWikiRelativePath(wikiRoot, raw)
          if (rel) into.add(rel)
        }
      }
      break
    }
    default:
      break
  }
}

/** NR bridge end + transcript mutation + tool_end SSE (+ optional TTS). */
export async function handleStreamToolExecutionEnd(
  ev: { type: 'tool_execution_end' } & ToolExecutionEndPayload,
  deps: StreamAgentSseHandlerDeps,
): Promise<void> {
  endToolCallSegmentBridge(ev.toolCallId)
  const resultText = toolResultText(ev)
  let details: unknown = undefined
  const fromRuntime = coerceToolResultDetailsObject(ev.result?.details)
  if (fromRuntime !== undefined) {
    details = fromRuntime
  }
  details = await resolveToolEndDetails(ev, deps, resultText, details)
  const { truncated: truncatedResult, resultCharCount, resultTruncated, resultSizeBucket } =
    toolResultSseForNr(ev.toolName, resultText, deps.sseMaxChars)
  const sequence = deps.refs.toolCallCount++
  applyToolEnd(deps.assistantState, ev.toolCallId, truncatedResult, ev.isError, details)
  const toolRow = deps.assistantState.parts.find(
    (p) => p.type === 'tool' && p.toolCall.id === ev.toolCallId,
  ) as { type: 'tool'; toolCall: { args: unknown } } | undefined
  const toolArgs = toolRow?.toolCall.args
  recordToolCallEnd({
    ...deps.turnLlm,
    toolCallId: ev.toolCallId,
    toolName: ev.toolName,
    args: toolArgs ?? {},
    isError: ev.isError,
    errorMessage:
      ev.isError && resultText.trim().length > 0
        ? truncateJsonResult(resultText, 400)
        : undefined,
    sequence,
    resultCharCount,
    resultTruncated,
    resultSizeBucket,
  })
  if (!ev.isError) {
    recordWikiMutationRelPaths(ev.toolName, toolArgs, deps.wikiDirForDiffs, deps.refs.touchedWikiRelPaths)
  }
  const speakForTts =
    ev.toolName === 'speak' && !ev.isError ? (resultText.trim() ? true : false) : false
  const playTts =
    speakForTts && isOpenAiTtsConfigured() ? ('openai' as const) : undefined
  await deps.stream.writeSSE({
    event: 'tool_end',
    data: JSON.stringify({
      id: ev.toolCallId,
      name: ev.toolName,
      result: truncatedResult,
      isError: ev.isError,
      ...(details !== undefined ? { details } : {}),
      ...(toolArgs != null && typeof toolArgs === 'object' ? { args: toolArgs } : {}),
      ...(playTts !== undefined ? { playTts } : {}),
    }),
  })
  if (playTts === 'openai') {
    try {
      for await (const buf of streamOpenAiTtsToBuffers(resultText)) {
        await deps.stream.writeSSE({
          event: 'tts_chunk',
          data: JSON.stringify({ id: ev.toolCallId, b64: buf.toString('base64') }),
        })
      }
      await deps.stream.writeSSE({
        event: 'tts_done',
        data: JSON.stringify({
          id: ev.toolCallId,
          format: openAiTtsResponseFormat(),
        }),
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      try {
        await deps.stream.writeSSE({
          event: 'tts_error',
          data: JSON.stringify({
            id: ev.toolCallId,
            message: message.slice(0, 2000),
          }),
        })
      } catch {
        /* ignore secondary SSE write failure */
      }
      console.error('[streamAgentSse] OpenAI TTS failed:', e)
    }
  }
}

export function handleStreamAgentEnd(
  event: { type: 'agent_end'; messages?: AgentMessage[] },
  deps: StreamAgentSseHandlerDeps,
): void {
  const messages = event.messages
  const rollup = sumUsageFromMessages(messages)
  deps.refs.lastRunUsage = rollup
  const turnDurationMs = Math.max(0, Math.round(performance.now() - deps.turnStartedAt))
  recordLlmTurnEndEvents({
    turn: deps.turnLlm,
    messages,
    usage: rollup,
    turnDurationMs,
    toolCallCount: deps.refs.toolCallCount,
  })
  const completionCount = countAssistantCompletionsWithUsage(messages ?? null)
  const { provider: pFromMsg, model: mFromMsg } = rollupAssistantLlmIds(messages ?? null)
  const provider = pFromMsg ?? process.env.LLM_PROVIDER?.trim() ?? 'unknown'
  const model = mFromMsg ?? process.env.LLM_MODEL?.trim() ?? 'unknown'
  /** Same envelope as wiki Expansion/Cleanup {@link wikiExpansionRunner} `logger.info(..., 'llm-turn')` for grep/correlation. */
  logger.info(
    {
      source: deps.turnLlm.source,
      kind: deps.agentKind,
      agentTurnId: deps.turnLlm.agentTurnId,
      provider,
      model,
      turnCount: 1,
      completionCount,
      cumulativeCompletionCount: completionCount,
      toolCallCount: deps.refs.toolCallCount,
      turnDurationMs,
      ...rollup,
      ...(deps.announceSessionId !== undefined ? { sessionId: deps.announceSessionId } : {}),
    },
    'llm-turn',
  )
}
