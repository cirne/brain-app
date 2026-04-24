import { randomUUID } from 'node:crypto'
import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core'
import type { Context } from 'hono'
import type { ChatMessage } from './chatTypes.js'
import { sumUsageFromMessages, type LlmUsageSnapshot } from './llmUsage.js'
import { streamSSE } from 'hono/streaming'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  applyStreamError,
  applyTextDelta,
  applyThinkingDelta,
  applyToolArgsUpsert,
  applyToolEnd,
  applyToolStart,
  createAssistantTurnState,
  extractStreamingToolCallsFromPartialAssistant,
  toAssistantMessage,
} from './chatTranscript.js'
import { buildReadEmailPreviewDetails } from './readEmailPreview.js'
import { createWikiUnifiedDiff, safeWikiRelativePath } from './wikiEditDiff.js'
import { writeWikiPartialFromStreamingWriteArgs } from './wikiStreamingPartialWrite.js'
import type { LlmAgentKind } from './llmAgentKind.js'
import {
  type LlmTurnTelemetry,
  recordLlmTurnEndEvents,
  recordToolCallEnd,
  recordToolCallStart,
  toolResultSseForNr,
} from './newRelicHelper.js'
import { truncateJsonResult } from './truncateJson.js'

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
}

/** Loosely typed pi-agent subscribe payloads (not exported from core). */
interface MessageUpdatePayload {
  assistantMessageEvent?: {
    type?: string
    delta?: string
  }
  message?: unknown
}

interface ToolExecutionStartPayload {
  toolCallId: string
  toolName: string
  args: unknown
}

interface ToolContentPart {
  type?: string
  text?: string
}

interface ToolExecutionEndPayload {
  toolCallId: string
  toolName: string
  isError?: boolean
  result?: {
    content?: ToolContentPart[]
    details?: unknown
  }
}

function toolResultText(ev: ToolExecutionEndPayload): string {
  const parts = ev.result?.content
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((c): c is ToolContentPart & { text: string } => c.type === 'text' && typeof c.text === 'string')
    .map(c => c.text)
    .join('')
}

/**
 * Stream agent events as SSE (same wire format as /api/chat).
 * Shared by chat route and onboarding profile/seed routes.
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
  } = opts
  const agentKind: LlmAgentKind = agentKindOpt ?? 'chat'

  return streamSSE(c, async (stream) => {
    if (announceSessionId) {
      await stream.writeSSE({ event: 'session', data: JSON.stringify({ sessionId: announceSessionId }) })
    }
    const initialT = initialSessionTitleOpt?.trim().slice(0, 120)
    let turnTitle: string | null | undefined =
      initialT && initialT.length > 0 ? initialT : undefined
    if (turnTitle) {
      if (onSessionTitlePersist) {
        try {
          await onSessionTitlePersist(turnTitle)
        } catch {
          /* ignore */
        }
      }
      try {
        await stream.writeSSE({
          event: 'chat_title',
          data: JSON.stringify({ title: turnTitle }),
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
    /** Set from `agent_end` (sum of assistant `usage` over the full `prompt()` run). */
    let lastRunUsage: LlmUsageSnapshot | undefined
    /** One `agent.prompt()` scope — correlates NR ToolCall / LlmCompletion / LlmAgentTurn. */
    const agentTurnId = randomUUID()
    const turnStartedAt = performance.now()
    /** Completed tools this turn (sequence = 0..n-1). */
    let toolCallCount = 0
    const turnLlm: LlmTurnTelemetry = {
      agentTurnId,
      source: 'chat',
      agentKind,
      correlation: announceSessionId !== undefined ? { sessionId: announceSessionId } : undefined,
    }
    const sseMaxChars = 4000

    const persistIfNeeded = async (): Promise<void> => {
      if (!onTurnComplete) return
      const base = toAssistantMessage(assistantState)
      const assistantMessage: ChatMessage =
        lastRunUsage !== undefined ? { ...base, usage: lastRunUsage } : base
      await onTurnComplete({ userMessage: userMessageForStore, assistantMessage, turnTitle })
      savedThisTurn = true
    }

    // Serialize per-Agent: must be immediately before subscribe (no await between here and
    // prompt). If waitForIdle ran earlier, another request could interleave after session writeSSE.
    await agent.waitForIdle()
    const unsubscribe = agent.subscribe(async (event) => {
      try {
        switch (event.type) {
          case 'message_update': {
            const payload = event as unknown as { type: 'message_update' } & MessageUpdatePayload
            const e = payload.assistantMessageEvent
            if (e?.type === 'text_delta') {
              const d = typeof e.delta === 'string' ? e.delta : String(e.delta ?? '')
              applyTextDelta(assistantState, d)
              await stream.writeSSE({
                event: 'text_delta',
                data: JSON.stringify({ delta: d }),
              })
            } else if (e?.type === 'thinking_delta') {
              const d = typeof e.delta === 'string' ? e.delta : String(e.delta ?? '')
              applyThinkingDelta(assistantState, d)
              await stream.writeSSE({
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
                applyToolArgsUpsert(assistantState, {
                  id: t.id,
                  name: t.name,
                  args: t.args,
                  done: false,
                })
                if (t.name === 'write') {
                  await writeWikiPartialFromStreamingWriteArgs(wikiDirForDiffs, t.name, t.args)
                }
                await stream.writeSSE({
                  event: 'tool_args',
                  data: JSON.stringify({
                    id: t.id,
                    name: t.name,
                    args: t.args,
                  }),
                })
              }
            }
            break
          }
          case 'tool_execution_start': {
            const te = event as unknown as { type: 'tool_execution_start' } & ToolExecutionStartPayload
            const id = te.toolCallId
            const name = te.toolName
            const args = te.args
            recordToolCallStart(id)
            applyToolStart(assistantState, { id, name, args, done: false })
            if (name === 'set_chat_title' && args && typeof args === 'object' && 'title' in args) {
              const t = String((args as { title?: unknown }).title ?? '').trim().slice(0, 120)
              if (t) {
                turnTitle = t
                if (onSessionTitlePersist) {
                  try {
                    await onSessionTitlePersist(t)
                  } catch {
                    /* ignore */
                  }
                }
              }
            }
            if (name === 'edit' && args && typeof args === 'object' && 'path' in args) {
              const rel = safeWikiRelativePath(wikiDirForDiffs, (args as { path: unknown }).path)
              if (rel) {
                try {
                  const beforeText = await readFile(join(wikiDirForDiffs, rel), 'utf-8')
                  editBeforeSnapshot.set(id, beforeText)
                } catch {
                  editBeforeSnapshot.set(id, '')
                }
              }
            }
            await stream.writeSSE({
              event: 'tool_start',
              data: JSON.stringify({
                id,
                name,
                args,
              }),
            })
            break
          }
          case 'tool_execution_end': {
            const ev = event as unknown as { type: 'tool_execution_end' } & ToolExecutionEndPayload
            const resultText = toolResultText(ev)
            let details: unknown = undefined
            if (ev.result?.details != null && typeof ev.result.details === 'object') {
              details = ev.result.details
            }
            if (ev.toolName === 'read_email' && resultText.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(resultText) as Record<string, unknown>
                const partBefore = assistantState.parts.find(
                  p => p.type === 'tool' && p.toolCall.id === ev.toolCallId,
                ) as { type: 'tool'; toolCall: { args: unknown } } | undefined
                const argsObj = partBefore?.toolCall.args
                const aid =
                  argsObj != null &&
                  typeof argsObj === 'object' &&
                  typeof (argsObj as { id?: unknown }).id === 'string'
                    ? (argsObj as { id: string }).id
                    : ''
                details = buildReadEmailPreviewDetails(parsed, aid)
              } catch {
                /* ignore */
              }
            } else if (ev.toolName === 'edit') {
              const snapBefore = editBeforeSnapshot.get(ev.toolCallId)
              editBeforeSnapshot.delete(ev.toolCallId)
              if (!ev.isError && snapBefore !== undefined) {
                const partBefore = assistantState.parts.find(
                  p => p.type === 'tool' && p.toolCall.id === ev.toolCallId,
                ) as { type: 'tool'; toolCall: { args: unknown } } | undefined
                const argsObj = partBefore?.toolCall.args
                const pathArg =
                  argsObj != null && typeof argsObj === 'object' && 'path' in argsObj
                    ? (argsObj as { path: unknown }).path
                    : undefined
                const rel = safeWikiRelativePath(wikiDirForDiffs, pathArg)
                if (rel) {
                  try {
                    const afterText = await readFile(join(wikiDirForDiffs, rel), 'utf-8')
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
            const { truncated: truncatedResult, resultCharCount, resultTruncated, resultSizeBucket } =
              toolResultSseForNr(ev.toolName, resultText, sseMaxChars)
            const sequence = toolCallCount++
            applyToolEnd(assistantState, ev.toolCallId, truncatedResult, ev.isError, details)
            const toolRow = assistantState.parts.find(
              p => p.type === 'tool' && p.toolCall.id === ev.toolCallId,
            ) as { type: 'tool'; toolCall: { args: unknown } } | undefined
            const toolArgs = toolRow?.toolCall.args
            recordToolCallEnd({
              ...turnLlm,
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
            await stream.writeSSE({
              event: 'tool_end',
              data: JSON.stringify({
                id: ev.toolCallId,
                name: ev.toolName,
                result: truncatedResult,
                isError: ev.isError,
                ...(details !== undefined ? { details } : {}),
                ...(toolArgs != null && typeof toolArgs === 'object'
                  ? { args: toolArgs }
                  : {}),
              }),
            })
            break
          }
          case 'agent_end': {
            const messages = (event as { messages?: AgentMessage[] }).messages
            const rollup = sumUsageFromMessages(messages)
            lastRunUsage = rollup
            recordLlmTurnEndEvents({
              turn: turnLlm,
              messages,
              usage: rollup,
              turnDurationMs: Math.max(0, Math.round(performance.now() - turnStartedAt)),
              toolCallCount,
            })
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({}),
            })
            try {
              await persistIfNeeded()
            } catch {
              /* best-effort */
            }
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

/** SSE with a fixed assistant reply (no LLM). Same wire format as /api/chat. */
export function streamStaticAssistantSse(
  c: Context,
  options: {
    announceSessionId?: string
    text: string
    userMessageForPersistence: string
    onTurnComplete?: StreamAgentSseOptions['onTurnComplete']
  },
): Response | Promise<Response> {
  const { announceSessionId, text, userMessageForPersistence, onTurnComplete } = options
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
    await stream.writeSSE({
      event: 'done',
      data: JSON.stringify({}),
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
