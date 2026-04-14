import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { getOrCreateSession, deleteSession } from '../agent/index.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '../lib/wikiDir.js'
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
} from '../lib/chatTranscript.js'
import { appendTurn, deleteSessionFile, loadSession, listSessions } from '../lib/chatStorage.js'
import { buildReadEmailPreviewDetails } from '../lib/readEmailPreview.js'
import { createWikiUnifiedDiff, safeWikiRelativePath } from '../lib/wikiEditDiff.js'

const chat = new Hono()

// GET /api/chat/sessions — list persisted sessions (register before /:sessionId)
chat.get('/sessions', async (c) => {
  const sessions = await listSessions()
  return c.json(sessions)
})

// GET /api/chat/sessions/:sessionId — full session document
chat.get('/sessions/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const doc = await loadSession(sessionId)
  if (!doc) return c.json({ error: 'Not found' }, 404)
  return c.json(doc)
})

// POST /api/chat
// Body: { message: string, sessionId?: string, context?: { files?: string[] } }
// Response: SSE stream of agent events
chat.post('/', async (c) => {
  const body = await c.req.json()
  const { message, sessionId = crypto.randomUUID(), context, timezone } = body

  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message is required' }, 400)
  }

  // Build context string for the session system prompt.
  // Two formats:
  //   string  — surface context (email body, wiki path, etc.) from AgentDrawer
  //   { files: string[] } — legacy file-grounded chat (wiki panel)
  let fileContext: string | undefined
  if (typeof context === 'string') {
    fileContext = context
  } else if (context?.files?.length) {
    const parts: string[] = []
    for (const filePath of context.files) {
      try {
        const content = await readFile(join(wikiDir(), filePath), 'utf-8')
        parts.push(`### ${filePath}\n\`\`\`markdown\n${content}\n\`\`\``)
      } catch {
        // Skip files that can't be read
      }
    }
    if (parts.length) fileContext = parts.join('\n\n')
  }

  const agent = await getOrCreateSession(sessionId, { context: fileContext, timezone })

  return streamSSE(c, async (stream) => {
    // Send session ID so client can continue the conversation
    await stream.writeSSE({ event: 'session', data: JSON.stringify({ sessionId }) })

    const userMessage = message
    const assistantState = createAssistantTurnState()
    /** `edit` tool: file contents before execute (for unified diff on success). */
    const editBeforeSnapshot = new Map<string, string>()
    let turnTitle: string | null | undefined
    let savedThisTurn = false

    const persistTurn = async (): Promise<void> => {
      const assistant = toAssistantMessage(assistantState)
      try {
        await appendTurn({
          sessionId,
          userMessage,
          assistantMessage: assistant,
          title: turnTitle,
        })
      } catch {
        // Best-effort persistence; do not fail the stream
      }
    }

    const unsubscribe = agent.subscribe(async (event) => {
      try {
        switch (event.type) {
          case 'message_update': {
            const e = (event as any).assistantMessageEvent
            if (e?.type === 'text_delta') {
              applyTextDelta(assistantState, e.delta)
              await stream.writeSSE({
                event: 'text_delta',
                data: JSON.stringify({ delta: e.delta }),
              })
            } else if (e?.type === 'thinking_delta') {
              applyThinkingDelta(assistantState, e.delta)
              await stream.writeSSE({
                event: 'thinking',
                data: JSON.stringify({ delta: e.delta }),
              })
            } else if (
              e?.type === 'toolcall_start' ||
              e?.type === 'toolcall_delta' ||
              e?.type === 'toolcall_end'
            ) {
              const partialMessage = (event as any).message
              const streamingTools = extractStreamingToolCallsFromPartialAssistant(partialMessage)
              for (const t of streamingTools) {
                if (t.name !== 'write' && t.name !== 'edit') continue
                applyToolArgsUpsert(assistantState, {
                  id: t.id,
                  name: t.name,
                  args: t.args,
                  done: false,
                })
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
            const id = (event as any).toolCallId as string
            const name = (event as any).toolName as string
            const args = (event as any).args
            applyToolStart(assistantState, { id, name, args, done: false })
            if (name === 'set_chat_title' && args && typeof args === 'object' && 'title' in args) {
              const t = String((args as { title?: unknown }).title ?? '').trim().slice(0, 120)
              if (t) turnTitle = t
            }
            if (name === 'edit' && args && typeof args === 'object' && 'path' in args) {
              const rel = safeWikiRelativePath(wikiDir(), (args as { path: unknown }).path)
              if (rel) {
                try {
                  const beforeText = await readFile(join(wikiDir(), rel), 'utf-8')
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
            const ev = event as any
            const resultText =
              ev.result?.content
                ?.filter((c: any) => c.type === 'text')
                ?.map((c: any) => c.text)
                ?.join('') ?? ''
            /** Full structured payload for UI previews — `result` text is truncated to 4k. */
            let details: unknown = undefined
            if (ev.toolName === 'list_inbox' && ev.result?.details != null && typeof ev.result.details === 'object') {
              details = ev.result.details
            } else if (ev.toolName === 'get_imessage_thread' && ev.result?.details != null && typeof ev.result.details === 'object') {
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
                /* ignore — preview falls back to parsing client result if any */
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
                const rel = safeWikiRelativePath(wikiDir(), pathArg)
                if (rel) {
                  try {
                    const afterText = await readFile(join(wikiDir(), rel), 'utf-8')
                    details = {
                      editDiff: {
                        path: rel,
                        unified: createWikiUnifiedDiff(rel, snapBefore, afterText),
                      },
                    }
                  } catch {
                    /* file missing after edit — skip structured diff */
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
            await persistTurn()
            savedThisTurn = true
            break
        }
      } catch {
        // Stream may be closed by client
      }
    })

    try {
      await agent.prompt(message)
    } catch (error: any) {
      try {
        const errMsg = error.message ?? 'Agent error'
        applyStreamError(assistantState, errMsg)
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: errMsg }),
        })
      } catch {
        // Stream closed
      }
    } finally {
      unsubscribe()
      if (!savedThisTurn) {
        // Partial turn (error before agent_end, or stream closed): still persist user + assistant so far
        await persistTurn()
      }
    }
  })
})

// DELETE /api/chat/:sessionId — delete a session and its persisted file
chat.delete('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  deleteSession(sessionId)
  await deleteSessionFile(sessionId)
  return c.json({ ok: true })
})

export default chat
