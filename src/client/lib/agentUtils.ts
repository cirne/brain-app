import { contextToString, type SurfaceContext } from '../router.js'

/** Keep in sync with `src/server/lib/llmUsage.ts` `LlmUsageSnapshot`. */
export type LlmUsageSnapshot = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  costTotal: number
}

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
  usage?: LlmUsageSnapshot
}

/** True when a text part with non-empty trimmed content exists (first reply token has arrived). */
export function assistantHasVisibleTextPart(msg: ChatMessage): boolean {
  for (const p of msg.parts ?? []) {
    if (p.type === 'text' && p.content.trim().length > 0) return true
  }
  return false
}

/** GET /api/skills row — slash menu in AgentInput. */
export type SkillMenuItem = {
  /** Directory / command id (use for `/<slug>`). */
  slug: string
  name: string
  label: string
  description: string
  hint?: string
  args?: string
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
        if (tc.isError || tc.done === false) continue
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
  /** Post-onboarding first turn: server opens with assistant (no user bubble). */
  firstChatKickoff?: boolean
  /**
   * Guided onboarding interview: send short kickoff text; server runs `ripmail whoami` and merges
   * into the model prompt, and persists the turn without a user row (`interviewKickoff` on POST body).
   */
  interviewKickoff?: boolean
  /** When true, server may inject read-aloud context; assistant uses `speak` (OpenAI TTS on the server). */
  hearReplies?: boolean
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  if (opts.firstChatKickoff) {
    body.firstChatKickoff = true
  } else {
    body.message = opts.message
    if (opts.interviewKickoff) {
      body.interviewKickoff = true
    }
  }
  if (opts.sessionId) body.sessionId = opts.sessionId
  if (opts.hearReplies === true) body.hearReplies = true

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
export function contextPlaceholder(ctx: SurfaceContext, hasMessages = false): string {
  if (ctx.type === 'email') return 'What do you want to do with this email?'
  if (ctx.type === 'wiki') return 'Edit, expand, or ask about this page…'
  if (ctx.type === 'wiki-dir') return 'Ask about this folder…'
  if (ctx.type === 'calendar') return 'Ask about your schedule...'
  if (ctx.type === 'inbox') return 'Inbox summary running...'
  if (ctx.type === 'messages') return 'Ask about this conversation…'
  return hasMessages ? 'What else can I help with?' : 'What do you need to know or get done?'
}

import type { ToolChatPolicy } from './tools/types.js'
import { getToolDefinitionCore } from './tools/registryCore.js'

/** @deprecated Prefer {@link ToolChatPolicy} from `./tools/types.js`. */
export type ToolUiPolicy = ToolChatPolicy

/** Chat/stream policy for a tool name; sourced from {@link getToolDefinitionCore} in `./tools/registryCore.js`. */
export function getToolUiPolicy(name: string): ToolUiPolicy {
  return getToolDefinitionCore(name).chat
}
