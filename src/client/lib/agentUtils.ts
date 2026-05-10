import { REJECT_QUESTION_TOOL_NAME } from '@shared/brainQueryReject.js'
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
  args: Record<string, unknown>
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
  /** Stable row id for `{#each}` keys and persistence (see server `chatTypes`). Assigned when missing. */
  id?: string
  role: 'user' | 'assistant'
  content: string
  parts?: MessagePart[]
  thinking?: string
  usage?: LlmUsageSnapshot
}

export function newChatMessageId(): string {
  return crypto.randomUUID()
}

/** Assigns missing ids (e.g. legacy session JSON) without rewriting existing stable ids. */
export function ensureChatMessageIds(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    typeof m.id === 'string' && m.id.length > 0 ? m : { ...m, id: newChatMessageId() },
  )
}

/**
 * Plain text from the latest assistant message (text parts + legacy `content`).
 * Matches server-side draft extraction for brain-query preview.
 */
export function lastAssistantPlainTextFromMessages(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const parts = m.parts
    if (parts?.length) {
      let acc = ''
      for (const p of parts) {
        if (p.type === 'text') acc += p.content
      }
      const t = acc.trim()
      if (t.length > 0) return t
    }
    const c = m.content?.trim()
    if (c && c.length > 0) return c
  }
  return ''
}

/**
 * Serializable snapshot of chat messages for persistence (e.g. preview history).
 * Prefer over `structuredClone`: agent stream payloads may include values browsers cannot clone.
 */
export function cloneChatMessagesSnapshot(messages: ChatMessage[]): ChatMessage[] {
  return JSON.parse(JSON.stringify(messages)) as ChatMessage[]
}

/**
 * Cross-brain preview: if the research agent refused via `reject_question`, returns the
 * collaborator-facing explanation (and optional reason for UI labels).
 */
export function extractBrainQueryEarlyRejectionFromChatMessages(
  messages: ChatMessage[],
): { explanation: string; reason?: string } | null {
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.parts?.length) continue
    for (const p of m.parts) {
      if (p.type !== 'tool') continue
      const tc = p.toolCall
      if (tc.name !== REJECT_QUESTION_TOOL_NAME || !tc.done) continue
      const det = tc.details as { explanation?: string; reason?: string; rejected?: boolean } | undefined
      const fromDetails = typeof det?.explanation === 'string' ? det.explanation.trim() : ''
      if (fromDetails)
        return {
          explanation: fromDetails,
          reason: typeof det?.reason === 'string' ? det.reason : undefined,
        }
      const args = tc.args as { explanation?: string } | undefined
      const fromArgs = typeof args?.explanation === 'string' ? args.explanation.trim() : ''
      if (fromArgs) return { explanation: fromArgs }
      const resultText = typeof tc.result === 'string' ? tc.result.trim() : ''
      if (resultText) return { explanation: resultText }
    }
  }
  return null
}

/** UI reference scale for the chat header token ring (not necessarily the active model context window). */
export const CHAT_TOKEN_METER_REFERENCE = 200_000

/**
 * Conversation unique-content token count: `input + output` summed across turns.
 *
 * **Why not `totalTokens`?**
 * Each turn's `totalTokens` = `input + cacheRead + output`. The `cacheRead` portion is the
 * cached context (system prompt, prior turns) re-read on every model completion within a turn —
 * a 6-completion turn re-reads the 12K system prompt 5 extra times as `cacheRead`, inflating
 * `totalTokens` without representing new content.
 *
 * **Why `input + output` counts correctly (once per unique token):**
 * - `input` is cumulative across completions: each token counted the first time it enters the
 *   context. System prompt counted on call-1, then only in `cacheRead` for calls 2-N.
 *   Same for user messages, tool calls, tool results.
 * - `output` counts each generated token once.
 * - Across turns: prior-turn content is already cached, so turn-N `input` only adds new content.
 *
 * Result: the same "unique tokens" figure you'd see in Cursor — system prompt once, each
 * message once, each tool result once. Use `totalTokens` only for cost calculations.
 */
export function sumAssistantUsageTotalTokens(messages: ChatMessage[]): number {
  let n = 0
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    const u = m.usage
    if (u == null) continue
    n += u.input + u.output
  }
  return n
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Coerce SSE / JSON `usage` to {@link LlmUsageSnapshot}; returns null if not an object. */
export function coerceLlmUsageSnapshot(raw: unknown): LlmUsageSnapshot | null {
  if (raw == null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  return {
    input: num(o.input),
    output: num(o.output),
    cacheRead: num(o.cacheRead),
    cacheWrite: num(o.cacheWrite),
    totalTokens: num(o.totalTokens),
    costTotal: num(o.costTotal),
  }
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

/**
 * Extract wiki paths from @-mentions. Personal vault uses `@me/...`; shared uses `@handle/...`.
 * Must not strip the inner `@` for peer handles.
 */
export function extractMentionedFiles(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(/@(me\/[\w./-]+\.md\b)/g)) {
    const p = m[1]
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  for (const m of text.matchAll(/@([\w.-]+\/[\w./-]+\.md\b)/g)) {
    const p = m[1]
    if (p.startsWith('me/')) continue
    const full = `@${p}`
    if (!seen.has(full)) {
      seen.add(full)
      out.push(full)
    }
  }
  return out
}

/** Build the POST /api/chat request body. Context and mentioned files are only
 *  sent on the first message of a session to avoid polluting subsequent turns. */
export function buildChatBody(opts: {
  message: string
  sessionId: string | null
  context: SurfaceContext
  mentionedFiles: string[]
  isFirstMessage: boolean
  /**
   * Unified initial bootstrap (onboarding-agent): assistant speaks first on `/api/chat`;
   * server builds kickoff from ripmail whoami (no user bubble).
   */
  initialBootstrapKickoff?: boolean
  /**
   * Guided onboarding interview (`POST /api/onboarding/interview`): send short kickoff text; server runs `ripmail whoami` and merges
   * into the model prompt, and persists the turn without a user row (`interviewKickoff` on POST body).
   */
  interviewKickoff?: boolean
  /** When true, server may inject read-aloud context; assistant uses `speak` (OpenAI TTS on the server). */
  hearReplies?: boolean
  /**
   * Human-readable user line for persistence when `message` is a wire token (e.g. finish chip).
   * Omit when the visible bubble matches `message`.
   */
  userMessageDisplay?: string
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
  if (opts.initialBootstrapKickoff) {
    body.initialBootstrapKickoff = true
  } else {
    body.message = opts.message
    if (opts.interviewKickoff) {
      body.interviewKickoff = true
    }
  }
  if (opts.sessionId) body.sessionId = opts.sessionId
  if (opts.hearReplies === true) body.hearReplies = true

  const display = opts.userMessageDisplay?.trim()
  if (display) body.userMessageDisplay = display

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
  if (ctx.type === 'email-draft') return 'Refine this draft or adjust recipients…'
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
