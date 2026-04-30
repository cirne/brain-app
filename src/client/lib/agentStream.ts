import type { ChatMessage, ToolPart } from './agentUtils.js'
import { getToolDefinitionCore } from './tools/registryCore.js'
import { isFilesystemAbsolutePath } from './fsPath.js'
import { wikiPathForReadToolArg } from './cards/contentCards.js'
import type { AgentOpenSource } from './navigateFromAgentOpen.js'
import { emit } from './app/appEvents.js'
import { playBrainTtsBlob } from './brainTtsAudio.js'

function ttsMimeType(format: string | undefined): string {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg'
    case 'opus':
      return 'audio/ogg'
    case 'aac':
      return 'audio/aac'
    case 'flac':
      return 'audio/flac'
    case 'wav':
      return 'audio/wav'
    case 'pcm':
      return 'audio/pcm'
    default:
      return 'audio/mpeg'
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Mirror server `applyToolArgsUpsert` so the chat UI can show tool rows while args stream (e.g. `write`). */
function upsertStreamingToolPart(
  msg: ChatMessage,
  data: { id: string; name: string; args?: unknown },
): void {
  const policy = getToolDefinitionCore(data.name).chat
  if (!policy.showInChat) return
  const parts = msg.parts!
  let part = parts.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
  const args =
    data.args != null && typeof data.args === 'object'
      ? (data.args as Record<string, unknown>)
      : {}
  if (!part) {
    parts.push({
      type: 'tool',
      toolCall: { id: data.id, name: data.name, args, done: false },
    })
  } else {
    part.toolCall.name = data.name
    part.toolCall.args = args
  }
}

export type ConsumeAgentChatStreamOptions = {
  /** Always read the live session messages array (avoids stale refs after `touchMessages` clones). */
  getMessages: () => ChatMessage[]
  msgIdx: number
  /**
   * When true, skip agent-driven **opening** of the right detail panel: wiki from `write`/`edit`,
   * navigation from `open` / `read_email`, and opening the draft overlay from **`draft_email`** on `tool_end`.
   * Transcript still updates; `onWriteStreaming` / `onEditStreaming` still run when the session is active.
   */
  suppressAgentDetailAutoOpen: boolean
  /**
   * When false, skip right-panel / overlay side effects tied to the active session.
   * Transcript and session state still update.
   */
  isActiveSession: () => boolean
  /**
   * Live check for Audio Conversation ("hear replies") toggle.
   * TTS playback respects the current UI state — if the user toggles off mid-stream, playback stops.
   */
  isHearRepliesEnabled: () => boolean
  onOpenWiki?: (_path: string) => void
  onWriteStreaming?: (_p: { path: string; content: string; done: boolean }) => void
  onEditStreaming?: (_p: { id: string; path: string; done: boolean }) => void
  onOpenFromAgent?: (
    _target: { type: string; path?: string; id?: string; date?: string },
    _source: AgentOpenSource,
  ) => void
  /** Desktop split only: open draft overlay when **`draft_email`** completes (`tool_end`). Respects {@link suppressAgentDetailAutoOpen}. */
  onOpenDraftFromAgent?: (_draftId: string, _subject?: string) => void
  setSessionId: (_id: string | null) => void
  setChatTitle: (_t: string | null) => void
  /** Call when mutating nested message state that needs a list identity refresh (matches prior `messages = [...messages]`). */
  touchMessages: () => void
  scrollToBottom: () => void
  /**
   * After `finish_conversation` tool completes successfully: main chat starts a new thread;
   * embedded panel chats (e.g. Hub add-folders) close the panel.
   */
  onFinishConversation?: () => void
}

/**
 * Reads the SSE body from a successful POST /api/chat response and applies deltas to `getMessages()[msgIdx]`.
 */
export async function consumeAgentChatStream(
  res: Response,
  options: ConsumeAgentChatStreamOptions,
): Promise<{ touchedWiki: boolean; sawDone: boolean }> {
  const {
    getMessages,
    msgIdx,
    suppressAgentDetailAutoOpen,
    isActiveSession,
    isHearRepliesEnabled,
    onOpenWiki,
    onWriteStreaming,
    onEditStreaming,
    onOpenFromAgent,
    onOpenDraftFromAgent,
    setSessionId,
    setChatTitle,
    touchMessages,
    scrollToBottom,
    onFinishConversation,
  } = options

  /** Agent tools that auto-open the detail panel must respect this (see `getToolDefinitionCore(name).chat.autoOpen` in `tools/registryCore.ts`). */
  const allowAgentDetailOpen = () => isActiveSession() && !suppressAgentDetailAutoOpen

  let touchedWiki = false
  const openedFromAgentByToolId = new Set<string>()
  const writeOpenedWikiForToolId = new Set<string>()
  const writePathByToolId = new Map<string, string>()
  const writeContentByToolId = new Map<string, string>()
  const toolArgsByToolId = new Map<string, Record<string, unknown>>()
  const ttsBinaryPartsByToolId = new Map<string, Uint8Array[]>()

  const body = res.body
  if (!body) {
    return { touchedWiki: false, sawDone: false }
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastEvent = 'message'
  let sawDone = false

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()!

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        lastEvent = line.slice(7).trim()
        continue
      }
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6))

        if (lastEvent === 'session') {
          setSessionId(typeof data.sessionId === 'string' ? data.sessionId : null)
          continue
        }
        if (lastEvent === 'chat_title') {
          const t = typeof data.title === 'string' ? data.title.trim().slice(0, 120) : ''
          if (t) setChatTitle(t)
          continue
        }
        if (lastEvent === 'done') {
          sawDone = true
          continue
        }

        if (lastEvent === 'tts_chunk' || lastEvent === 'tts_done' || lastEvent === 'tts_error') {
          const id = typeof data.id === 'string' ? data.id : ''
          if (!id) continue
          if (!isActiveSession() || !isHearRepliesEnabled()) {
            ttsBinaryPartsByToolId.delete(id)
            continue
          }
          if (lastEvent === 'tts_chunk') {
            if (typeof data.b64 === 'string' && data.b64) {
              const part = base64ToUint8Array(data.b64)
              const ar = ttsBinaryPartsByToolId.get(id) ?? []
              ar.push(part)
              ttsBinaryPartsByToolId.set(id, ar)
            }
            continue
          }
          if (lastEvent === 'tts_error') {
            ttsBinaryPartsByToolId.delete(id)
            continue
          }
          if (lastEvent === 'tts_done') {
            const parts = ttsBinaryPartsByToolId.get(id) ?? []
            ttsBinaryPartsByToolId.delete(id)
            const format = typeof data.format === 'string' ? data.format : 'mp3'
            const blob = new Blob(parts as BlobPart[], { type: ttsMimeType(format) })
            if (parts.length === 0 || blob.size === 0) {
              continue
            }
            void playBrainTtsBlob(blob).catch(() => {})
            continue
          }
        }

        const msg = getMessages()[msgIdx]
        if (!msg || msg.role !== 'assistant') continue
        if (!msg.parts) msg.parts = []

        switch (lastEvent) {
          case 'text_delta': {
            const parts = msg.parts!
            const last = parts[parts.length - 1]
            if (last?.type === 'text') {
              last.content += data.delta
            } else {
              parts.push({ type: 'text', content: data.delta })
            }
            touchMessages()
            if (isActiveSession()) scrollToBottom()
            break
          }
          case 'thinking':
            msg.thinking = (msg.thinking ?? '') + data.delta
            touchMessages()
            break
          case 'tool_args': {
            const policy = getToolDefinitionCore(data.name).chat
            if (policy.streamToDetail === 'wiki') {
              const path = typeof data.args?.path === 'string' ? data.args.path : ''
              const content = typeof data.args?.content === 'string' ? data.args.content : ''
              if (path) writePathByToolId.set(data.id, path)
              if (content) writeContentByToolId.set(data.id, content)
              /* Do not call onOpenWiki here: streamed JSON may emit path prefixes (e.g. "properties")
               * before the full path ("properties/son-story-ranch.md"), navigating to a bogus URL and 404ing the wiki pane.
               * Auto-open runs once from tool_start with complete args. */
              if (data.name === 'write') {
                if (isActiveSession()) onWriteStreaming?.({ path, content, done: false })
              } else if (data.name === 'edit') {
                if (isActiveSession()) onEditStreaming?.({ id: data.id, path, done: false })
              }
            }
            upsertStreamingToolPart(msg, data)
            touchMessages()
            if (isActiveSession()) scrollToBottom()
            break
          }
          case 'tool_start': {
            // Side effects still branch on `data.name` (SSE contract). Policy bits use `getToolDefinitionCore`.
            const policy = getToolDefinitionCore(data.name).chat
            if (data.name === 'set_chat_title') {
              const parts = msg.parts!
              const existing = parts.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
              if (existing) {
                existing.toolCall.name = data.name
                existing.toolCall.args = data.args
              } else {
                parts.push({ type: 'tool', toolCall: { id: data.id, name: data.name, args: data.args, done: false } })
              }
              if (typeof data.args?.title === 'string') {
                const t = data.args.title.trim().slice(0, 120)
                if (t) setChatTitle(t)
              }
              touchMessages()
            } else {
              upsertStreamingToolPart(msg, data)
              if (data.args != null && typeof data.args === 'object') {
                toolArgsByToolId.set(data.id, data.args as Record<string, unknown>)
              }
              if (data.name === 'open' && data.args?.target && onOpenFromAgent && !openedFromAgentByToolId.has(data.id)) {
                openedFromAgentByToolId.add(data.id)
                if (allowAgentDetailOpen() && policy.autoOpen) onOpenFromAgent(data.args.target, 'open')
              }
              if (data.name === 'read_email' && typeof data.args?.id === 'string' && onOpenFromAgent && !openedFromAgentByToolId.has(data.id)) {
                openedFromAgentByToolId.add(data.id)
                if (allowAgentDetailOpen() && policy.autoOpen) {
                  const rid = String(data.args.id).trim()
                  if (isFilesystemAbsolutePath(rid)) {
                    onOpenFromAgent({ type: 'file', path: rid }, 'read_email')
                  } else {
                    onOpenFromAgent({ type: 'email', id: rid }, 'read_email')
                  }
                }
              }
              if (
                (data.name === 'write' || data.name === 'edit') &&
                data.args &&
                typeof data.args === 'object' &&
                typeof (data.args as { path?: unknown }).path === 'string' &&
                onOpenWiki
              ) {
                const rawPath = String((data.args as { path: string }).path).trim()
                const wikiPolicy = getToolDefinitionCore(data.name).chat
                if (
                  rawPath &&
                  allowAgentDetailOpen() &&
                  wikiPolicy.streamToDetail === 'wiki' &&
                  wikiPolicy.autoOpen &&
                  !writeOpenedWikiForToolId.has(data.id)
                ) {
                  writeOpenedWikiForToolId.add(data.id)
                  onOpenWiki(wikiPathForReadToolArg(rawPath))
                }
              }
              touchMessages()
            }
            if (isActiveSession()) scrollToBottom()
            break
          }
          case 'tool_end': {
            const policy = getToolDefinitionCore(data.name).chat
            let part = msg.parts!.find(p => p.type === 'tool' && p.toolCall.id === data.id) as ToolPart | undefined
            const writePath = policy.streamToDetail === 'wiki' ? writePathByToolId.get(data.id) : undefined
            const writeContent = policy.streamToDetail === 'wiki' ? writeContentByToolId.get(data.id) : undefined
            const stashedArgs = toolArgsByToolId.get(data.id)
            toolArgsByToolId.delete(data.id)
            const endArgs =
              data.args != null && typeof data.args === 'object'
                ? data.args
                : stashedArgs
            const resolvedArgs = writePath ? { path: writePath, content: writeContent } : endArgs ?? {}
            if (!part) {
              part = {
                type: 'tool',
                toolCall: {
                  id: data.id,
                  name: data.name,
                  args: resolvedArgs,
                  result: data.result,
                  details: data.details,
                  isError: data.isError,
                  done: true,
                },
              }
              msg.parts!.push(part)
            } else {
              part.toolCall.result = data.result
              if (data.details !== undefined) part.toolCall.details = data.details
              part.toolCall.isError = data.isError
              part.toolCall.done = true
              if (writePath) part.toolCall.args = { path: writePath, content: writeContent }
              else if (endArgs !== undefined) part.toolCall.args = endArgs
            }
            const name = part.toolCall.name
            if (name === 'write' || name === 'edit' || name === 'delete') touchedWiki = true
            if (
              name === 'manage_sources' &&
              !data.isError &&
              part.toolCall.args &&
              typeof part.toolCall.args === 'object'
            ) {
              const op = (part.toolCall.args as { op?: string }).op
              if (op === 'add' || op === 'remove' || op === 'edit' || op === 'reindex') {
                emit({ type: 'hub:sources-changed' })
              }
            }
            if (name === 'refresh_sources' && !data.isError) {
              emit({ type: 'hub:sources-changed' })
            }
            if (
              (name === 'draft_email' || name === 'edit_draft') &&
              !data.isError &&
              data.details &&
              typeof data.details === 'object'
            ) {
              const draftId = String((data.details as { id?: unknown }).id ?? '').trim()
              if (draftId) {
                emit({ type: 'email-draft:refresh', draftId })
                if (
                  name === 'draft_email' &&
                  allowAgentDetailOpen() &&
                  onOpenDraftFromAgent
                ) {
                  const sub = (data.details as { subject?: unknown }).subject
                  const subject =
                    typeof sub === 'string' && sub.trim() ? sub.trim() : undefined
                  onOpenDraftFromAgent(draftId, subject)
                }
              }
            }
            if (name === 'finish_conversation' && !data.isError) {
              onFinishConversation?.()
            }
            if (policy.streamToDetail === 'wiki') {
              writePathByToolId.delete(data.id)
              writeContentByToolId.delete(data.id)
              if (name === 'write') {
                if (isActiveSession()) onWriteStreaming?.({ path: '', content: '', done: true })
              } else if (name === 'edit') {
                if (isActiveSession()) onEditStreaming?.({ id: data.id, path: '', done: true })
              }
            }
            touchMessages()
            if (isActiveSession()) scrollToBottom()
            break
          }
          case 'error':
            msg.parts!.push({ type: 'text', content: `\n\n**Error:** ${data.message}` })
            touchMessages()
            break
        }
      }
    }
  }

  return { touchedWiki, sawDone }
}
