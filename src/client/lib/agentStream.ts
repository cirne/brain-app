import { getToolUiPolicy, type ChatMessage, type ToolPart } from './agentUtils.js'
import type { AgentOpenSource } from './navigateFromAgentOpen.js'

export type ConsumeAgentChatStreamOptions = {
  messages: ChatMessage[]
  msgIdx: number
  suppressAgentWikiAutoOpen: boolean
  /**
   * When false, skip right-panel / overlay side effects (wiki auto-open, streaming preview, open tool).
   * Transcript and session state still update.
   */
  isActiveSession: () => boolean
  onOpenWiki?: (_path: string) => void
  onWriteStreaming?: (_p: { path: string; content: string; done: boolean }) => void
  onEditStreaming?: (_p: { id: string; path: string; done: boolean }) => void
  onOpenFromAgent?: (
    _target: { type: string; path?: string; id?: string; date?: string },
    _source: AgentOpenSource,
  ) => void
  setSessionId: (_id: string | null) => void
  setChatTitle: (_t: string | null) => void
  /** Call when mutating nested message state that needs a list identity refresh (matches prior `messages = [...messages]`). */
  touchMessages: () => void
  scrollToBottom: () => void
}

/**
 * Reads the SSE body from a successful POST /api/chat response and applies deltas to `messages[msgIdx]`.
 */
export async function consumeAgentChatStream(
  res: Response,
  options: ConsumeAgentChatStreamOptions,
): Promise<{ touchedWiki: boolean; sawDone: boolean }> {
  const {
    messages,
    msgIdx,
    suppressAgentWikiAutoOpen,
    isActiveSession,
    onOpenWiki,
    onWriteStreaming,
    onEditStreaming,
    onOpenFromAgent,
    setSessionId,
    setChatTitle,
    touchMessages,
    scrollToBottom,
  } = options

  let touchedWiki = false
  const openedFromAgentByToolId = new Set<string>()
  const writeOpenedWikiForToolId = new Set<string>()
  const writePathByToolId = new Map<string, string>()
  const writeContentByToolId = new Map<string, string>()
  const toolArgsByToolId = new Map<string, Record<string, unknown>>()

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
        const msg = messages[msgIdx]

        switch (lastEvent) {
          case 'session':
            setSessionId(typeof data.sessionId === 'string' ? data.sessionId : null)
            break
          case 'text_delta': {
            const parts = msg.parts!
            const last = parts[parts.length - 1]
            if (last?.type === 'text') {
              last.content += data.delta
            } else {
              parts.push({ type: 'text', content: data.delta })
            }
            if (isActiveSession()) scrollToBottom()
            break
          }
          case 'thinking':
            msg.thinking = (msg.thinking ?? '') + data.delta
            break
          case 'tool_args': {
            const policy = getToolUiPolicy(data.name)
            if (policy.streamToDetail === 'wiki') {
              const path = typeof data.args?.path === 'string' ? data.args.path : ''
              const content = typeof data.args?.content === 'string' ? data.args.content : ''
              if (path) writePathByToolId.set(data.id, path)
              if (content) writeContentByToolId.set(data.id, content)
              if (path && !writeOpenedWikiForToolId.has(data.id)) {
                writeOpenedWikiForToolId.add(data.id)
                if (
                  isActiveSession() &&
                  !suppressAgentWikiAutoOpen &&
                  policy.autoOpen
                ) {
                  onOpenWiki?.(path)
                }
              }
              if (data.name === 'write') {
                if (isActiveSession()) onWriteStreaming?.({ path, content, done: false })
              } else if (data.name === 'edit') {
                if (isActiveSession()) onEditStreaming?.({ id: data.id, path, done: false })
              }
            }
            break
          }
          case 'tool_start': {
            const policy = getToolUiPolicy(data.name)
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
              if (data.args != null && typeof data.args === 'object') {
                toolArgsByToolId.set(data.id, data.args as Record<string, unknown>)
              }
              if (data.name === 'open' && data.args?.target && onOpenFromAgent && !openedFromAgentByToolId.has(data.id)) {
                openedFromAgentByToolId.add(data.id)
                if (isActiveSession() && policy.autoOpen) onOpenFromAgent(data.args.target, 'open')
              }
              if (data.name === 'read_email' && typeof data.args?.id === 'string' && onOpenFromAgent && !openedFromAgentByToolId.has(data.id)) {
                openedFromAgentByToolId.add(data.id)
                if (isActiveSession() && policy.autoOpen) {
                  onOpenFromAgent({ type: 'email', id: data.args.id }, 'read_email')
                }
              }
            }
            if (isActiveSession()) scrollToBottom()
            break
          }
          case 'tool_end': {
            const policy = getToolUiPolicy(data.name)
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
            break
          case 'done':
            sawDone = true
            break
        }
      }
    }
  }

  return { touchedWiki, sawDone }
}
