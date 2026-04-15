import { contextToString, type SurfaceContext } from '../router.js'

export type ToolCall = {
  id: string
  name: string
  args: any
  result?: string
  /** Structured tool payload from SSE (e.g. ripmail inbox JSON) when text is truncated or redundant. */
  details?: unknown
  isError?: boolean
  done: boolean
}

export type TextPart = { type: 'text'; content: string }
export type ToolPart = { type: 'tool'; toolCall: ToolCall }
export type MessagePart = TextPart | ToolPart

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  parts?: MessagePart[]
  thinking?: string
}

/** Extract wiki file paths referenced in assistant messages (tool args + wiki: links). */
export function extractReferencedFiles(messages: ChatMessage[]): string[] {
  const seen = new Set<string>()
  const files: string[] = []
  const wikiRe = /\]\(wiki:([^)]+)\)/g
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type === 'tool') {
        const tc = part.toolCall
        const path = tc.args?.path as string | undefined
        if (!path?.endsWith('.md') || seen.has(path)) continue
        if (tc.name === 'read' && (tc.isError || tc.done === false)) continue
        seen.add(path)
        files.push(path)
      } else if (part.type === 'text') {
        let m
        wikiRe.lastIndex = 0
        while ((m = wikiRe.exec(part.content)) !== null) {
          const p = m[1].endsWith('.md') ? m[1] : `${m[1]}.md`
          if (!seen.has(p)) { seen.add(p); files.push(p) }
        }
      }
    }
  }
  return files
}

/** Extract @path/to/file.md mentions from a message string. */
export function extractMentionedFiles(text: string): string[] {
  return [...text.matchAll(/@([\w/.-]+\.md)/g)].map(m => m[1])
}

/** Build the POST /api/chat request body. Context and mentioned files are only
 *  sent on the first message of a session to avoid polluting subsequent turns. */
export function buildChatBody(opts: {
  message: string
  sessionId: string | null
  context: SurfaceContext
  mentionedFiles: string[]
  isFirstMessage: boolean
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    message: opts.message,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  if (opts.sessionId) body.sessionId = opts.sessionId

  if (opts.isFirstMessage) {
    const parts: string[] = []
    const ctxStr = contextToString(opts.context)
    if (ctxStr) parts.push(ctxStr)
    if (opts.mentionedFiles.length) parts.push(`Referenced files: ${opts.mentionedFiles.join(', ')}`)
    if (parts.length) body.context = parts.join('\n')
  }

  return body
}

/** Placeholder text for the input bar based on current surface context. */
export function contextPlaceholder(ctx: SurfaceContext): string {
  if (ctx.type === 'email') return 'What do you want to do with this email?'
  if (ctx.type === 'wiki') return 'Ask about this doc...'
  if (ctx.type === 'calendar') return 'Ask about your schedule...'
  if (ctx.type === 'inbox') return 'Inbox summary running...'
  if (ctx.type === 'messages') return 'Ask about this conversation…'
  if (ctx.type === 'chat') return "What's on your mind?"
  return 'Ask anything...'
}

export type ToolUiPolicy = {
  showInChat: boolean
  streamToDetail?: 'wiki' | 'email' | 'calendar'
  /** If true, `consumeAgentChatStream` may open the right detail panel when the tool runs (unless `suppressAgentDetailAutoOpen`). */
  autoOpen?: boolean
  label?: string
}

const DEFAULT_POLICY: ToolUiPolicy = {
  showInChat: true,
}

export const TOOL_UI_POLICIES: Record<string, ToolUiPolicy> = {
  write: { showInChat: true, streamToDetail: 'wiki', autoOpen: true, label: 'Writing file' },
  edit: { showInChat: true, streamToDetail: 'wiki', autoOpen: true, label: 'Editing file' },
  set_chat_title: { showInChat: false },
  open: { showInChat: true, autoOpen: true, label: 'Opening' },
  read_email: { showInChat: true, autoOpen: true, label: 'Reading email' },
}

export function getToolUiPolicy(name: string): ToolUiPolicy {
  return TOOL_UI_POLICIES[name] ?? DEFAULT_POLICY
}
