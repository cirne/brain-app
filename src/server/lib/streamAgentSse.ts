import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core'
import type { Context } from 'hono'
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

export interface StreamAgentSseOptions {
  /** Wiki root for edit diffs and safeWikiRelativePath (may differ from main app wiki). */
  wikiDirForDiffs: string
  /** First SSE event: `session` with this id (main /api/chat). */
  announceSessionId?: string
  /** If set, persist completed turns (main chat). Onboarding omits this. */
  onTurnComplete?: (args: {
    userMessage: string
    assistantMessage: ReturnType<typeof toAssistantMessage>
    turnTitle: string | null | undefined
  }) => Promise<void>
  /** When set (e.g. slash skills), passed to `agent.prompt()` instead of `message`. */
  promptMessages?: AgentMessage[]
  /** Transcript / storage user line; defaults to `message` (use with slash expansion). */
  userMessageForPersistence?: string
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
  const { wikiDirForDiffs, onTurnComplete, announceSessionId, promptMessages, userMessageForPersistence } =
    opts

  return streamSSE(c, async (stream) => {
    if (announceSessionId) {
      await stream.writeSSE({ event: 'session', data: JSON.stringify({ sessionId: announceSessionId }) })
    }
    const userMessage = userMessageForPersistence ?? message
    const assistantState = createAssistantTurnState()
    const editBeforeSnapshot = new Map<string, string>()
    let turnTitle: string | null | undefined
    let savedThisTurn = false

    const persistIfNeeded = async (): Promise<void> => {
      if (!onTurnComplete) return
      const assistantMessage = toAssistantMessage(assistantState)
      await onTurnComplete({ userMessage, assistantMessage, turnTitle })
      savedThisTurn = true
    }

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
            applyToolStart(assistantState, { id, name, args, done: false })
            if (name === 'set_chat_title' && args && typeof args === 'object' && 'title' in args) {
              const t = String((args as { title?: unknown }).title ?? '').trim().slice(0, 120)
              if (t) turnTitle = t
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
            if (ev.toolName === 'list_inbox' && ev.result?.details != null && typeof ev.result.details === 'object') {
              details = ev.result.details
            } else if (
              (ev.toolName === 'get_message_thread' || ev.toolName === 'get_imessage_thread') &&
              ev.result?.details != null &&
              typeof ev.result.details === 'object'
            ) {
              details = ev.result.details
            } else if (ev.toolName === 'read_email' && resultText.trim().startsWith('{')) {
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
            applyToolEnd(assistantState, ev.toolCallId, resultText.slice(0, 4000), ev.isError, details)
            const toolRow = assistantState.parts.find(
              p => p.type === 'tool' && p.toolCall.id === ev.toolCallId,
            ) as { type: 'tool'; toolCall: { args: unknown } } | undefined
            const toolArgs = toolRow?.toolCall.args
            await stream.writeSSE({
              event: 'tool_end',
              data: JSON.stringify({
                id: ev.toolCallId,
                name: ev.toolName,
                result: resultText.slice(0, 4000),
                isError: ev.isError,
                ...(details !== undefined ? { details } : {}),
                ...(toolArgs != null && typeof toolArgs === 'object'
                  ? { args: toolArgs }
                  : {}),
              }),
            })
            break
          }
          case 'agent_end':
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
