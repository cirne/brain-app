import type { ChatMessage, ToolCall } from '../agentUtils.js'
import { matchContentPreview, wikiPathForReadToolArg } from '../cards/contentCards.js'
import { isFilesystemAbsolutePath } from '../fsPath.js'
import { getToolDefinitionCore } from '../tools/registryCore.js'
import { readDocIdHint } from '../tools/onboardingHelpers.js'
import {
  parseFindPersonResultPeople,
  type ProfilingPersonRef,
} from '../tools/ripmailWhoParse.js'
import type { SeedingProgressLine, SeedingProgressUiRow } from '../tools/types.js'

export type { SeedingProgressLine, SeedingProgressUiRow }
export { parseFindPersonResultPeople, type ProfilingPersonRef }

export type ProfilingEmailRef = {
  id: string
  subject: string
  from: string
  snippet: string
}

/** Assistant transcript slice: narrative text interleaved with mail read from `read_doc`. */
export type ProfilingTranscriptEvent =
  | { type: 'text'; content: string }
  | { type: 'email'; done: boolean; toolId: string; row: ProfilingEmailRef }

function profilingReadDocEmailRow(tc: ToolCall): ProfilingEmailRef | null {
  if (tc.name !== 'read_doc') return null
  const args = (tc.args ?? {}) as Record<string, unknown>
  const idArg = typeof args.id === 'string' ? args.id.trim() : ''
  if (!idArg || isFilesystemAbsolutePath(idArg)) return null

  if (tc.done && !tc.isError) {
    const prev = matchContentPreview(tc)
    if (prev?.kind === 'email') {
      return {
        id: prev.id,
        subject: prev.subject,
        from: prev.from,
        snippet: prev.snippet,
      }
    }
    return null
  }

  if (tc.isError) return null

  return {
    id: idArg,
    subject: '',
    from: '',
    snippet: readDocIdHint(idArg) ?? '',
  }
}

/**
 * Ordered profiling transcript: same assistant part order as the model stream, with each
 * mail `read_doc` shown as a card at its tool position (not batched at the end).
 */
export function buildProfilingTranscriptEvents(messages: ChatMessage[]): ProfilingTranscriptEvent[] {
  const events: ProfilingTranscriptEvent[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type === 'text' && part.content?.trim()) {
        events.push({ type: 'text', content: part.content })
      } else if (part.type === 'tool') {
        const tc = part.toolCall
        if (tc.name === 'set_chat_title') continue
        if (tc.name !== 'read_doc') continue
        const row = profilingReadDocEmailRow(tc)
        if (!row) continue
        events.push({
          type: 'email',
          done: !!tc.done && !tc.isError,
          toolId: tc.id,
          row,
        })
      }
    }
  }
  return events
}

const MAX_EMAIL_ROWS = 24
const MAX_WIKI_ROWS = 40
const MAX_PEOPLE_ROWS = 48

/**
 * People surfaced by completed `find_person` tools, in encounter order, deduped with richer names preferred.
 */
export function extractProfilingPeople(messages: ChatMessage[]): {
  people: ProfilingPersonRef[]
  peopleOverflow: number
} {
  const order: string[] = []
  const byId = new Map<string, ProfilingPersonRef>()

  function upsert(next: ProfilingPersonRef) {
    const prev = byId.get(next.id)
    if (!prev) {
      order.push(next.id)
      byId.set(next.id, { ...next })
      return
    }
    if (next.name && next.name.length > prev.name.length && next.name !== prev.email) {
      prev.name = next.name
    }
    if (next.email && !prev.email) prev.email = next.email
  }

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type !== 'tool') continue
      const tc = part.toolCall
      if (tc.name !== 'find_person' || !tc.done || tc.isError) continue
      const raw = tc.result ?? ''
      if (!String(raw).trim()) continue
      for (const p of parseFindPersonResultPeople(String(raw))) {
        upsert(p)
      }
    }
  }

  const peopleAll = order.map((id) => byId.get(id)!)
  const peopleOverflow = Math.max(0, peopleAll.length - MAX_PEOPLE_ROWS)
  const people = peopleAll.slice(0, MAX_PEOPLE_ROWS)
  return { people, peopleOverflow }
}

/**
 * Wiki paths and mail threads gathered from completed assistant tool calls (via
 * {@link matchContentPreview}). Does not parse assistant markdown text.
 */
export function extractProfilingResources(messages: ChatMessage[]): {
  wikiPaths: string[]
  wikiOverflow: number
  emails: ProfilingEmailRef[]
  emailOverflow: number
} {
  const wikiSeen = new Set<string>()
  const wikiPaths: string[] = []

  const emailById = new Map<string, ProfilingEmailRef>()

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type !== 'tool') continue
      const tc = part.toolCall
      if (!tc.done || tc.isError) continue
      const preview = matchContentPreview(tc)
      if (!preview) continue
      if (preview.kind === 'wiki') {
        const p = preview.path
        if (!wikiSeen.has(p)) {
          wikiSeen.add(p)
          wikiPaths.push(p)
        }
      } else if (preview.kind === 'wiki_edit_diff') {
        const p = preview.path
        if (!wikiSeen.has(p)) {
          wikiSeen.add(p)
          wikiPaths.push(p)
        }
      } else if (preview.kind === 'email') {
        emailById.set(preview.id, {
          id: preview.id,
          subject: preview.subject,
          from: preview.from,
          snippet: preview.snippet,
        })
      }
    }
  }

  const emailsAll = [...emailById.values()]
  const emailOverflow = Math.max(0, emailsAll.length - MAX_EMAIL_ROWS)
  const emails = emailsAll.slice(0, MAX_EMAIL_ROWS)

  const wikiOverflow = Math.max(0, wikiPaths.length - MAX_WIKI_ROWS)
  const wikiPathsCapped = wikiPaths.slice(0, MAX_WIKI_ROWS)

  return { wikiPaths: wikiPathsCapped, wikiOverflow, emails, emailOverflow }
}

/** True when the tool path is the vault-root profile file (`me.md`). */
export function isProfilingMeMdPath(path: string): boolean {
  const p = wikiPathForReadToolArg(path).toLowerCase()
  return p === 'me.md' || p.endsWith('/me.md')
}

/**
 * Latest completed `write` of `me.md` in the assistant turn (after tool_end), for UI preview
 * when streaming args are cleared.
 */
export function extractLastMeMdWriteContent(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    const parts = m.parts ?? []
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]
      if (part.type !== 'tool') continue
      const tc = part.toolCall
      if (tc.name !== 'write' || !tc.done) continue
      const rawPath = typeof tc.args?.path === 'string' ? tc.args.path : ''
      if (!isProfilingMeMdPath(rawPath)) continue
      const content = typeof tc.args?.content === 'string' ? tc.args.content : ''
      if (content.trim()) return content
    }
  }
  return null
}

export type OnboardingActivityKind = 'profiling' | 'seeding'

const THINKING_SNIPPET_MAX = 140

/**
 * Latest non-empty thinking buffer from the assistant turn (models that stream reasoning).
 */
export function lastAssistantThinking(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.thinking?.trim()) return m.thinking.trim()
  }
  return ''
}

function snippetThinking(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= THINKING_SNIPPET_MAX) return oneLine
  return `${oneLine.slice(0, THINKING_SNIPPET_MAX - 1)}…`
}

/**
 * Last non–set_chat_title tool in the assistant turn (for status + icons).
 */
export function lastMeaningfulToolCall(messages: ChatMessage[]): ToolCall | null {
  let last: ToolCall | null = null
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type !== 'tool') continue
      if (part.toolCall.name === 'set_chat_title') continue
      last = part.toolCall
    }
  }
  return last
}

function lastMeaningfulTool(messages: ChatMessage[]): { name: string | null; done: boolean } {
  const tc = lastMeaningfulToolCall(messages)
  if (!tc) return { name: null, done: true }
  return { name: tc.name, done: !!tc.done }
}

/**
 * One-line status for onboarding activity views while the agent is streaming.
 */
export function onboardingActivityLine(
  messages: ChatMessage[],
  streaming: boolean,
  kind: OnboardingActivityKind,
): string {
  if (!streaming) return ''

  const thinking = lastAssistantThinking(messages)
  const { name: lastName, done: lastDone } = lastMeaningfulTool(messages)

  if (lastName && !lastDone) {
    const inflight = getToolDefinitionCore(lastName).onboardingActivityInFlight?.[kind]
    if (inflight) return inflight
    return `Running ${lastName}…`
  }

  if (thinking) return snippetThinking(thinking)

  if (!lastName) {
    return kind === 'seeding' ? 'Starting wiki seed…' : 'Gathering context…'
  }

  return kind === 'seeding' ? 'Working on your wiki…' : 'Synthesizing your profile…'
}

/**
 * @deprecated Use {@link onboardingActivityLine} with `'profiling'`.
 */
export function profilingActivityLine(messages: ChatMessage[], streaming: boolean): string {
  return onboardingActivityLine(messages, streaming, 'profiling')
}

function orderedMeaningfulToolCalls(messages: ChatMessage[]): ToolCall[] {
  const out: ToolCall[] = []
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type !== 'tool') continue
      if (part.toolCall.name === 'set_chat_title') continue
      out.push(part.toolCall)
    }
  }
  return out
}

const PLANNING_THINKING_MAX = 100

/** Strip URLs/paths from model thinking so the between-tools row stays readable (no file:// dumps). */
function sanitizePlanningThinking(raw: string): string | undefined {
  let one = raw.replace(/\s+/g, ' ').trim()
  if (!one) return undefined
  one = one.replace(/file:\/\/[^\s]+/gi, '')
  one = one.replace(/https?:\/\/[^\s]+/gi, '')
  one = one.replace(/\s+/g, ' ').trim()
  if (!one) return undefined
  one = one.replace(/(?:\/[\w.-]+\.(?:jpg|jpeg|png|gif|webp|pdf))\b/gi, '')
  one = one.replace(/\s+/g, ' ').trim()
  if (!one) return undefined
  if (one.length > PLANNING_THINKING_MAX) return `${one.slice(0, PLANNING_THINKING_MAX - 1)}…`
  return one
}

function formatSeedingCompletedLine(tc: ToolCall): SeedingProgressLine | null {
  return getToolDefinitionCore(tc.name).seedingProgressLine?.('done', tc) ?? null
}

function formatSeedingActiveLine(tc: ToolCall): SeedingProgressLine | null {
  return getToolDefinitionCore(tc.name).seedingProgressLine?.('active', tc) ?? null
}

export type SeedingProgressEvent = 
  | { type: 'row'; done: boolean; line: SeedingProgressLine }
  | { type: 'text'; content: string }

/**
 * Ordered seeding steps: one UI row per meaningful tool (parallel writes each keep their own row),
 * interspersed with assistant narrative text.
 */
export function buildSeedingProgressUi(
  messages: ChatMessage[],
  streaming: boolean,
): { events: SeedingProgressEvent[]; planning: SeedingProgressLine | null } {
  const events: SeedingProgressEvent[] = []
  const orderedTools = orderedMeaningfulToolCalls(messages)

  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts ?? []) {
      if (part.type === 'text' && part.content?.trim()) {
        events.push({ type: 'text', content: part.content })
      } else if (part.type === 'tool') {
        const tc = part.toolCall
        if (tc.name === 'set_chat_title') continue
        const line = tc.done ? formatSeedingCompletedLine(tc) : formatSeedingActiveLine(tc)
        if (line) {
          events.push({ type: 'row', done: !!tc.done, line })
        }
      }
    }
  }

  if (!streaming) {
    return { events, planning: null }
  }

  const hasActiveTool = orderedTools.some((tc) => !tc.done)
  if (hasActiveTool) {
    return { events, planning: null }
  }

  const thinking = lastAssistantThinking(messages)
  if (messages.length === 0) {
    return {
      events,
      planning: { id: 'planning', kind: 'planning', prefix: 'Starting wiki seed…' },
    }
  }
  const planningDetail = sanitizePlanningThinking(thinking)
  return {
    events,
    planning: {
      id: 'planning',
      kind: 'planning',
      prefix: 'Working on your wiki…',
      detail: planningDetail,
    },
  }
}
