import { randomUUID, createHash } from 'node:crypto'
import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core'
import type { Context } from 'hono'
import type { ChatMessage } from './chatTypes.js'
import { isZeroUsage, addLlmUsage } from '@server/lib/llm/llmUsage.js'
import { coerceToolResultDetailsObject } from '@server/lib/llm/coerceToolResultDetails.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'
import { runSuggestReplyRepairIfNeeded } from '@server/lib/chat/suggestReplyRepair.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'
import { streamSSE } from 'hono/streaming'
import {
  applyStreamError,
  applyTextDelta,
  applyToolEnd,
  applyToolStart,
  createAssistantTurnState,
  toAssistantMessage,
} from './chatTranscript.js'
import type { LlmAgentKind } from '@server/lib/llm/llmAgentKind.js'
import {
  mergeToolCallCorrelation,
  type LlmTurnTelemetry,
  releaseAllPendingToolCallSegments,
  setAgentTurnTransactionAttribute,
} from '@server/lib/observability/newRelicHelper.js'
import {
  attachAgentDiagnosticsCollector,
  writeSyntheticTurnDiagnosticsJsonl,
  type DiagToolTraceEntry,
} from '@server/lib/observability/agentDiagnostics.js'
import {
  handleStreamAgentEnd,
  handleStreamMessageUpdate,
  handleStreamToolExecutionEnd,
  handleStreamToolExecutionStart,
  type StreamAgentSseHandlerDeps,
  type StreamAgentSseTurnRefs,
} from './streamAgentSseHandlers.js'
import type {
  MessageUpdatePayload,
  ToolExecutionEndPayload,
  ToolExecutionStartPayload,
} from './streamAgentSseTypes.js'
import { FINISH_CONVERSATION_TOOL_RESULT_TEXT } from '@shared/finishConversationShortcut.js'
import { truncateJsonResult } from '@server/lib/llm/truncateJson.js'

export interface StreamAgentSseOptions {
  /** Wiki root for edit diffs and safeWikiRelativePath (may differ from main app wiki). */
  wikiDirForDiffs: string
  /** First SSE event: `session` with this id (main /api/chat). */
  announceSessionId?: string
  /** If set, persist completed turns (main chat). Onboarding omits this. */
  onTurnComplete?: (args: {
    /** Null when {@link omitUserMessageFromPersistence} — assistant-only turn in storage. */
    userMessage: string | null
    /** Usage is set when `agent_end` reported model token/cost totals for this run (multi-round sum). */
    assistantMessage: ChatMessage
    turnTitle: string | null | undefined
  }) => Promise<void>
  /** When set (e.g. slash skills), passed to `agent.prompt()` instead of `message`. */
  promptMessages?: AgentMessage[]
  /** Transcript / storage user line; defaults to `message` (use with slash expansion). */
  userMessageForPersistence?: string
  /** When true, do not append a user row for this turn (e.g. first-chat kickoff opens with the assistant). */
  omitUserMessageFromPersistence?: boolean
  /** When set_chat_title runs mid-stream, persist title so the session list updates before the turn completes. */
  onSessionTitlePersist?: (title: string) => Promise<void>
  /**
   * When set (e.g. slash skill with no session title yet), persist and notify the client before the model runs
   * so the chat list shows a human title instead of the raw `/slug …` command.
   */
  initialSessionTitle?: string
  /**
   * New Relic / usage: which **agent class** is running (main chat vs slash skill vs onboarding, etc.).
   * Default `chat` when omitted (tests and legacy call sites).
   */
  agentKind?: LlmAgentKind
  /** IANA timezone (e.g. for suggest-reply repair `createAgentTools` calendar). */
  timezone?: string
  /**
   * When true (default), after `agent.prompt()` run {@link runSuggestReplyRepairIfNeeded} when
   * the turn has assistant text but no valid `suggest_reply_options` (main chat and onboarding interview).
   */
  runSuggestReplyRepair?: boolean
}

/**
 * Stream agent events as SSE (same wire format as /api/chat).
 * Callers: main chat route and onboarding `POST /api/onboarding/interview`.
 * After each `agent.prompt()`, runs {@link runSuggestReplyRepairIfNeeded} when enabled and the turn
 * has assistant text but no valid `suggest_reply_options` (unless `BRAIN_SUGGEST_REPLY_REPAIR=0`).
 */
export function streamAgentSseResponse(
  c: Context,
  agent: Agent,
  message: string,
  opts: StreamAgentSseOptions,
): Response | Promise<Response> {
  const {
    wikiDirForDiffs,
    onTurnComplete,
    announceSessionId,
    promptMessages,
    userMessageForPersistence,
    omitUserMessageFromPersistence,
    onSessionTitlePersist,
    initialSessionTitle: initialSessionTitleOpt,
    agentKind: agentKindOpt,
    timezone: timezoneOpt,
    runSuggestReplyRepair: runSuggestReplyRepairOpt,
  } = opts
  const agentKind: LlmAgentKind = agentKindOpt ?? 'chat'
  const runSuggestReplyRepair = runSuggestReplyRepairOpt !== false

  // One id for the whole turn. Must be created and sent to NR *before* `streamSSE`'s async
  // callback — that callback runs outside the web request's async context, so
  // `addCustomAttribute` there would not attach to the transaction.
  const agentTurnId = randomUUID()
  setAgentTurnTransactionAttribute(agentTurnId)
  // Merge tenant `workspaceHandle` while request ALS is active. Inside `streamSSE`, tool/end
  // telemetry may run detached from AsyncLocalStorage; `mergeToolCallCorrelation` at emit time
  // misses the handle unless we freeze it here.
  const turnCorrelation = mergeToolCallCorrelation(
    announceSessionId !== undefined ? { sessionId: announceSessionId } : undefined,
  )

  return streamSSE(c, async (stream) => {
    if (announceSessionId) {
      await stream.writeSSE({ event: 'session', data: JSON.stringify({ sessionId: announceSessionId }) })
    }
    const initialT = initialSessionTitleOpt?.trim().slice(0, 120)
    const refs: StreamAgentSseTurnRefs = {
      turnTitle: initialT && initialT.length > 0 ? initialT : undefined,
      lastRunUsage: undefined,
      toolCallCount: 0,
      touchedWikiRelPaths: new Set(),
    }
    if (refs.turnTitle) {
      if (onSessionTitlePersist) {
        try {
          await onSessionTitlePersist(refs.turnTitle)
        } catch {
          /* ignore */
        }
      }
      try {
        await stream.writeSSE({
          event: 'chat_title',
          data: JSON.stringify({ title: refs.turnTitle }),
        })
      } catch {
        /* closed */
      }
    }
    const userMessageForStore = omitUserMessageFromPersistence
      ? null
      : (userMessageForPersistence ?? message)
    const assistantState = createAssistantTurnState()
    const editBeforeSnapshot = new Map<string, string>()
    let savedThisTurn = false
    /** One `agent.prompt()` scope — correlates NR ToolCall / LlmCompletion / LlmAgentTurn. */
    const turnStartedAt = performance.now()
    const turnLlm: LlmTurnTelemetry = {
      agentTurnId,
      source: 'chat',
      agentKind,
      correlation: turnCorrelation,
    }
    const sseMaxChars = 4000

    const handlerDeps = (): StreamAgentSseHandlerDeps => ({
      stream,
      wikiDirForDiffs,
      assistantState,
      editBeforeSnapshot,
      refs,
      onSessionTitlePersist,
      sseMaxChars,
      turnLlm,
      turnStartedAt,
      agentKind,
      announceSessionId,
    })

    const persistIfNeeded = async (): Promise<void> => {
      if (!onTurnComplete) return
      const base = toAssistantMessage(assistantState)
      const assistantMessage: ChatMessage =
        refs.lastRunUsage !== undefined ? { ...base, usage: refs.lastRunUsage } : base
      await onTurnComplete({ userMessage: userMessageForStore, assistantMessage, turnTitle: refs.turnTitle })
      savedThisTurn = true
    }

    // Serialize per-Agent: must be immediately before subscribe (no await between here and
    // prompt). If waitForIdle ran earlier, another request could interleave after session writeSSE.
    await agent.waitForIdle()
    const unsubscribeDiag = attachAgentDiagnosticsCollector(agent, {
      agentTurnId,
      agentKind,
      source: 'chat_sse',
      ...(announceSessionId !== undefined ? { sessionId: announceSessionId } : {}),
    })
    const unsubscribe = agent.subscribe(async (event) => {
      try {
        const deps = handlerDeps()
        switch (event.type) {
          case 'message_update': {
            await handleStreamMessageUpdate(
              event as unknown as { type: 'message_update' } & MessageUpdatePayload,
              deps,
            )
            break
          }
          case 'tool_execution_start': {
            await handleStreamToolExecutionStart(
              event as unknown as { type: 'tool_execution_start' } & ToolExecutionStartPayload,
              deps,
            )
            break
          }
          case 'tool_execution_end': {
            await handleStreamToolExecutionEnd(
              event as unknown as { type: 'tool_execution_end' } & ToolExecutionEndPayload,
              deps,
            )
            break
          }
          case 'agent_end': {
            handleStreamAgentEnd(event as { type: 'agent_end'; messages?: AgentMessage[] }, deps)
            break
          }
        }
      } catch {
        // Stream may be closed
      }
    })

    try {
      if (promptMessages?.length) {
        await agent.prompt(promptMessages)
      } else {
        await agent.prompt(message)
      }
      if (runSuggestReplyRepair) {
        try {
          const userText = userMessageForStore ?? message
          const repair = await runSuggestReplyRepairIfNeeded({
            wikiDir: wikiDirForDiffs,
            userMessageText: userText,
            assistantState,
            includeLocalMessageTools: areLocalMessageToolsEnabled(),
            timezone: timezoneOpt,
            parentAgentTurnId: agentTurnId,
            ...(announceSessionId !== undefined ? { sessionId: announceSessionId } : {}),
          })
          if (repair.applied) {
            if (refs.lastRunUsage === undefined) {
              refs.lastRunUsage = repair.usage
            } else {
              refs.lastRunUsage = isZeroUsage(repair.usage)
                ? refs.lastRunUsage
                : addLlmUsage(refs.lastRunUsage, repair.usage)
            }
            for (let i = assistantState.parts.length - 1; i >= 0; i -= 1) {
              const p = assistantState.parts[i]
              if (p.type !== 'tool' || p.toolCall.name !== 'suggest_reply_options' || p.toolCall.id !== repair.toolCallId) {
                continue
              }
              const tc = p.toolCall
              const tr = typeof tc.result === 'string' ? tc.result : ''
              const d = tc.details
              try {
                await stream.writeSSE({
                  event: 'tool_start',
                  data: JSON.stringify({
                    id: tc.id,
                    name: tc.name,
                    args: tc.args,
                  }),
                })
                const details = coerceToolResultDetailsObject(d) ?? d
                await stream.writeSSE({
                  event: 'tool_end',
                  data: JSON.stringify({
                    id: tc.id,
                    name: tc.name,
                    result: tr,
                    isError: tc.isError === true,
                    ...(details !== undefined ? { details } : {}),
                    ...(tc.args != null && typeof tc.args === 'object' ? { args: tc.args } : {}),
                  }),
                })
              } catch {
                /* stream closed */
              }
              break
            }
          }
        } catch (e) {
          brainLogger.error({ err: e }, 'suggest-reply-repair failed')
        }
      }
      try {
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify(
            refs.lastRunUsage !== undefined ? { usage: refs.lastRunUsage } : {},
          ),
        })
      } catch {
        /* closed */
      }
      try {
        await persistIfNeeded()
      } catch {
        /* best-effort */
      }
    } catch (error: unknown) {
      try {
        const errMsg = error instanceof Error ? error.message : String(error)
        applyStreamError(assistantState, errMsg)
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: errMsg }),
        })
      } catch {
        /* closed */
      }
    } finally {
      releaseAllPendingToolCallSegments()
      unsubscribeDiag()
      unsubscribe()
      if (onTurnComplete && !savedThisTurn) {
        try {
          await persistIfNeeded()
        } catch {
          /* ignore */
        }
      }
    }
  })
}

/**
 * No LLM: emits `finish_conversation` like a real tool run so the client closes / starts fresh chat.
 * Pi-agent session is not updated — callers should only use this when the UI will abandon the thread.
 */
export function streamFinishConversationShortcutSse(
  c: Context,
  options: {
    announceSessionId?: string
    userMessageForPersistence: string
    onTurnComplete?: StreamAgentSseOptions['onTurnComplete']
  },
): Response | Promise<Response> {
  const { announceSessionId, userMessageForPersistence, onTurnComplete } = options
  const toolId = randomUUID()
  const diagTurnId = randomUUID()
  const shortcutStartedAt = performance.now()
  return streamSSE(c, async (stream) => {
    if (announceSessionId) {
      await stream.writeSSE({ event: 'session', data: JSON.stringify({ sessionId: announceSessionId }) })
    }
    const assistantState = createAssistantTurnState()
    applyToolStart(assistantState, {
      id: toolId,
      name: 'finish_conversation',
      args: {},
      done: false,
    })
    applyToolEnd(
      assistantState,
      toolId,
      FINISH_CONVERSATION_TOOL_RESULT_TEXT,
      false,
      { ok: true as const },
    )
    let sseEmittedDone = false
    try {
      await stream.writeSSE({
        event: 'tool_start',
        data: JSON.stringify({
          id: toolId,
          name: 'finish_conversation',
          args: {},
        }),
      })
      await stream.writeSSE({
        event: 'tool_end',
        data: JSON.stringify({
          id: toolId,
          name: 'finish_conversation',
          args: {},
          result: FINISH_CONVERSATION_TOOL_RESULT_TEXT,
          isError: false,
          details: { ok: true },
        }),
      })
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({}),
      })
      sseEmittedDone = true
    } catch {
      /* stream closed */
    } finally {
      const durationMs = Math.max(0, Math.round(performance.now() - shortcutStartedAt))
      const finishText = FINISH_CONVERSATION_TOOL_RESULT_TEXT
      const resultPreview = truncateJsonResult(finishText, 2000)
      const resultSha256 = createHash('sha256').update(finishText, 'utf8').digest('hex')
      const argsJsonBytes = Buffer.byteLength(JSON.stringify({}), 'utf8')
      const resultJsonBytes = Buffer.byteLength(finishText, 'utf8')
      const toolTrace: DiagToolTraceEntry[] = [
        {
          toolCallId: toolId,
          toolName: 'finish_conversation',
          isError: false,
          durationMs: 0,
          argsJsonBytes,
          resultJsonBytes,
          resultTruncated: false,
          resultSha256,
          resultPreview,
        },
      ]
      try {
        await writeSyntheticTurnDiagnosticsJsonl({
          meta: {
            agentTurnId: diagTurnId,
            agentKind: 'finish_conversation_shortcut',
            source: 'chat_sse_finish_shortcut',
            ...(announceSessionId !== undefined ? { sessionId: announceSessionId } : {}),
          },
          fileKind: 'finish_conversation_shortcut',
          durationMs,
          toolTrace,
          transcript: {
            shortcut: true,
            sseEmittedDone,
            userLinePreview: userMessageForPersistence,
          },
          events: [
            {
              kind: 'event' as const,
              seq: 1,
              type: 'tool_execution_end',
              toolCallId: toolId,
              toolName: 'finish_conversation',
              isError: false,
              result: finishText,
            },
          ],
        })
      } catch {
        /* best-effort */
      }
    }
    if (onTurnComplete) {
      try {
        await onTurnComplete({
          userMessage: userMessageForPersistence,
          assistantMessage: toAssistantMessage(assistantState),
          turnTitle: null,
        })
      } catch {
        /* best-effort */
      }
    }
  })
}

/** SSE with a fixed assistant reply (no LLM). Same wire format as /api/chat. */
export function streamStaticAssistantSse(
  c: Context,
  options: {
    announceSessionId?: string
    text: string
    userMessageForPersistence: string
    onTurnComplete?: StreamAgentSseOptions['onTurnComplete']
    /** Forward on final `done` so the client can tag the streamed row (tunnel awaiting-peer UI). */
    doneB2bDelivery?: 'awaiting_peer_review'
  },
): Response | Promise<Response> {
  const { announceSessionId, text, userMessageForPersistence, onTurnComplete, doneB2bDelivery } = options
  return streamSSE(c, async (stream) => {
    if (announceSessionId) {
      await stream.writeSSE({ event: 'session', data: JSON.stringify({ sessionId: announceSessionId }) })
    }
    const assistantState = createAssistantTurnState()
    applyTextDelta(assistantState, text)
    await stream.writeSSE({
      event: 'text_delta',
      data: JSON.stringify({ delta: text }),
    })
    const donePayload =
      doneB2bDelivery === 'awaiting_peer_review' ? { b2bDelivery: 'awaiting_peer_review' as const } : {}
    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify(donePayload),
    })
    if (onTurnComplete) {
      try {
        await onTurnComplete({
          userMessage: userMessageForPersistence,
          assistantMessage: toAssistantMessage(assistantState),
          turnTitle: null,
        })
      } catch {
        /* best-effort */
      }
    }
  })
}
