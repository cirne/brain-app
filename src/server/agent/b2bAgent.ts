import { Agent } from '@mariozechner/pi-agent-core'
import type { AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage } from '@mariozechner/pi-ai'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import Handlebars from 'handlebars'
import { resolveLlmApiKey } from '@server/lib/llm/resolveModel.js'
import { chainLlmOnPayloadNoThinking } from '@server/lib/llm/llmOnPayloadChain.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { createAgentTools, type CreateAgentToolsOptions } from './tools.js'
import { B2B_QUERY_ONLY } from './agentToolSets.js'
import {
  buildDateContext,
  requireFastBrainLlm,
  requireStandardBrainLlm,
  type PromptClockOptions,
} from './agentFactory.js'
import { meProfilePromptSection } from './assistantAgent.js'

export type B2BGrantPolicy = {
  id: string
  owner_id: string
  asker_id: string
  privacy_policy: string
}

export type B2BAgentOptions = {
  ownerDisplayName: string
  ownerHandle?: string | null
  timezone?: string
  promptClock?: PromptClockOptions
  initialMessages?: AgentMessage[]
}

export function createB2BToolOptions(timezone?: string): CreateAgentToolsOptions {
  return {
    includeLocalMessageTools: false,
    onlyToolNames: B2B_QUERY_ONLY,
    timezone,
    calendarAllowedOps: ['events', 'search', 'list_calendars'],
  }
}

export function buildB2BResearchPrompt(params: {
  ownerDisplayName: string
  wikiRoot: string
  timezone?: string
  promptClock?: PromptClockOptions
}): string {
  return renderPromptTemplate('b2b/research.hbs', {
    ownerDisplayName: params.ownerDisplayName,
    dateContext: new Handlebars.SafeString(buildDateContext(params.timezone ?? 'UTC', params.promptClock)),
    ownerProfile: new Handlebars.SafeString(meProfilePromptSection(params.wikiRoot)),
  })
}

export function buildB2BFilterPrompt(params: { privacyPolicy: string; draftAnswer: string }): string {
  return renderPromptTemplate('b2b/filter.hbs', {
    privacyPolicy: params.privacyPolicy,
    draftAnswer: params.draftAnswer,
  })
}

export function buildB2BPreflightPrompt(message: string): string {
  return renderPromptTemplate('b2b/preflight.hbs', { message })
}

/** Exported for eval harness / unit tests (same logic as production preflight). */
export function parsePreflightExpectsResponse(raw: string): boolean | null {
  const t = raw.trim()
  if (!t) return null
  const tryParse = (s: string): boolean | null => {
    try {
      const j = JSON.parse(s) as { expectsResponse?: unknown }
      if (typeof j.expectsResponse === 'boolean') return j.expectsResponse
    } catch {
      /* ignore */
    }
    return null
  }
  const direct = tryParse(t)
  if (direct !== null) return direct
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start >= 0 && end > start) return tryParse(t.slice(start, end + 1))
  return null
}

/**
 * Classifier-only agent: **optional `BRAIN_FAST_LLM`** (cheaper); when unset uses **`BRAIN_LLM`**
 * (see {@link requireFastBrainLlm}).
 */
export function createB2BPreflightAgent(message: string): Agent {
  const model = requireFastBrainLlm()
  return new Agent({
    initialState: {
      systemPrompt: buildB2BPreflightPrompt(message),
      model,
      tools: [],
      thinkingLevel: 'off',
    },
    onPayload: (params, m) => chainLlmOnPayloadNoThinking(params, m),
    getApiKey: (p: string) => resolveLlmApiKey(p),
    convertToLlm,
  })
}

/** User turn for preflight (system prompt carries the inbound message). */
export const B2B_PREFLIGHT_USER_TURN =
  'Return only the JSON object described in your system prompt (one line, no markdown).'

/**
 * One-shot preflight: same model selection as {@link createB2BPreflightAgent} (`BRAIN_FAST_LLM` when set, else `BRAIN_LLM`).
 * When parsing fails, defaults to `true` (draft) to avoid silently dropping real questions.
 */
export async function runB2BPreflight(message: string): Promise<boolean> {
  const trimmed = message.trim()
  if (!trimmed) return true
  const agent = createB2BPreflightAgent(trimmed)
  const raw = await promptB2BAgentForText(agent, B2B_PREFLIGHT_USER_TURN)
  const parsed = parsePreflightExpectsResponse(raw)
  return parsed ?? true
}

/**
 * B2B research pass (tools + draft). Per-grant `privacy_policy` is **not** embedded here; callers apply
 * {@link filterB2BResponse} afterward. `_grant` keeps the call signature stable for callers.
 */
export function createB2BAgent(_grant: B2BGrantPolicy, wikiRoot: string, options: B2BAgentOptions): Agent {
  const model = requireStandardBrainLlm()
  const tools = createAgentTools(wikiRoot, createB2BToolOptions(options.timezone))
  const systemPrompt = buildB2BResearchPrompt({
    ownerDisplayName: options.ownerDisplayName,
    wikiRoot,
    timezone: options.timezone,
    promptClock: options.promptClock,
  })

  return new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: 'off',
      ...(options.initialMessages?.length ? { messages: options.initialMessages } : {}),
    },
    onPayload: (params, m) => chainLlmOnPayloadNoThinking(params, m),
    getApiKey: (p: string) => resolveLlmApiKey(p),
    convertToLlm,
  })
}

export function createB2BFilterAgent(policy: string, draftAnswer: string): Agent {
  const model = requireStandardBrainLlm()
  return new Agent({
    initialState: {
      systemPrompt: buildB2BFilterPrompt({ privacyPolicy: policy, draftAnswer }),
      model,
      tools: [],
      thinkingLevel: 'off',
    },
    onPayload: (params, m) => chainLlmOnPayloadNoThinking(params, m),
    getApiKey: (p: string) => resolveLlmApiKey(p),
    convertToLlm,
  })
}

function lastAssistantTextFromMessages(messages: AgentMessage[] | null | undefined): string {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || typeof m !== 'object' || !('role' in m) || m.role !== 'assistant') continue
    const am = m as AssistantMessage
    if (!Array.isArray(am.content)) continue
    const text = am.content
      .filter((c): c is { type: 'text'; text: string } => c?.type === 'text' && typeof c.text === 'string')
      .map(c => c.text)
      .join('')
      .trim()
    if (text) return text
  }
  return ''
}

/** User turn for the B2B privacy filter agent (draft is embedded in the system prompt). */
export const B2B_FILTER_USER_TURN = 'Return the filtered answer.'

/** Product semantics when the filter model returns only whitespace. */
export function finalizeB2BFilteredText(filteredRaw: string): string {
  return filteredRaw.trim() || "I can't answer that from the access currently granted."
}

export async function promptB2BAgentForText(agent: Agent, message: string): Promise<string> {
  let endMessages: AgentMessage[] = []
  await agent.waitForIdle()
  const unsubscribe = agent.subscribe(async (event: AgentEvent) => {
    if (event.type === 'agent_end' && 'messages' in event) {
      endMessages = (event as { messages: AgentMessage[] }).messages
    }
  })
  try {
    await agent.prompt(message)
  } finally {
    unsubscribe()
  }
  return lastAssistantTextFromMessages(endMessages)
}

export async function filterB2BResponse(params: { privacyPolicy: string; draftAnswer: string }): Promise<string> {
  const agent = createB2BFilterAgent(params.privacyPolicy, params.draftAnswer)
  const filtered = await promptB2BAgentForText(agent, B2B_FILTER_USER_TURN)
  return finalizeB2BFilteredText(filtered)
}
