import { Agent } from '@mariozechner/pi-agent-core'
import type { KnownProvider } from '@mariozechner/pi-ai'
import { resolveLlmApiKey, resolveModel } from '@server/lib/llm/resolveModel.js'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import Handlebars from 'handlebars'
import { createAgentTools } from './tools.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { wikiDir as getWikiDir } from '@server/lib/wiki/wikiDir.js'
import { chainLlmOnPayload } from '@server/lib/llm/llmOnPayloadChain.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'
import { formatSkillLibrarySection } from '@server/lib/llm/skillRegistry.js'
import { loadSession } from '@server/lib/chat/chatStorage.js'
import { persistedChatMessagesToAgentMessages } from '@server/lib/chat/persistedChatToAgentMessages.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { isMultiTenantMode } from '@server/lib/tenant/dataRoot.js'
import { resolveEvalAnchoredNow } from '@server/lib/llm/evalAssistantClock.js'

const sessions = new Map<string, Agent>()

const USER_PROFILE_BEGIN = '<<<BEGIN_USER_PROFILE_FROM_ME_MD>>>'
const USER_PROFILE_END = '<<<END_USER_PROFILE_FROM_ME_MD>>>'

const ASSISTANT_PROFILE_BEGIN = '<<<BEGIN_ASSISTANT_PROFILE_FROM_ASSISTANT_MD>>>'
const ASSISTANT_PROFILE_END = '<<<END_ASSISTANT_PROFILE_FROM_ASSISTANT_MD>>>'

/**
 * Non-empty when wiki/me.md exists — full file body is injected into the main agent system prompt.
 * Exported for tests.
 */
export function meProfilePromptSection(wikiRoot: string): string {
  const path = join(wikiRoot, 'me.md')
  if (!existsSync(path)) return ''
  let body: string
  try {
    body = readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
  return `\n## User profile (me.md)\nThe block below is the user's profile from **me.md** at the wiki root. It is core context for this session—use it to tailor tone, context, and priorities. Do not assume facts that are not in the wiki, tools, or this profile. **Do not** call the read tool for \`me.md\` unless the user explicitly asks you to reload it.\n\n${USER_PROFILE_BEGIN}\n${body}${body.endsWith('\n') ? '' : '\n'}${USER_PROFILE_END}\n`
}

/**
 * Non-empty when wiki/assistant.md exists — charter, voice, boundaries (same vault as me.md).
 * Exported for tests.
 */
export function assistantProfilePromptSection(wikiRoot: string): string {
  const path = join(wikiRoot, 'assistant.md')
  if (!existsSync(path)) return ''
  let body: string
  try {
    body = readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
  return `\n## Assistant identity & charter (assistant.md)\nThe block below defines **your** role, priorities, tone, and boundaries from **assistant.md** at the wiki root. Follow it unless the user overrides in chat. **Do not** call the read tool for \`assistant.md\` unless the user explicitly asks you to reload it.\n\n${ASSISTANT_PROFILE_BEGIN}\n${body}${body.endsWith('\n') ? '' : '\n'}${ASSISTANT_PROFILE_END}\n`
}

export function buildBaseSystemPrompt(includeLocalMessageCapabilities: boolean, wikiRoot: string): string {
  const meHint = meProfilePromptSection(wikiRoot)
  const assistantHint = assistantProfilePromptSection(wikiRoot)
  return renderPromptTemplate('assistant/base.hbs', {
    meHint: new Handlebars.SafeString(meHint),
    assistantHint: new Handlebars.SafeString(assistantHint),
    includeLocalMessageCapabilities,
    multiTenant: isMultiTenantMode(),
  })
}

function firstChatPromptSection(includeLocalMessageCapabilities: boolean): string {
  return renderPromptTemplate('assistant/first-chat.hbs', {
    includeLocalMessageCapabilities,
  })
}

export interface SessionOptions {
  /** Pre-injected file context for file-grounded chat */
  context?: string
  /** Override wiki directory */
  wikiDir?: string
  /** IANA timezone from the browser client (e.g. "America/Chicago") */
  timezone?: string
  /** First assistant turn after onboarding — extra prompt guidance (OPP-018). */
  firstChat?: boolean
}

/**
 * Get an existing agent session or create a new one.
 * On first create for a `sessionId`, the agent is **hydrated** from the on-disk chat JSON (if any)
 * so the model sees prior turns after a process restart or when opening a saved chat.
 */
export async function getOrCreateSession(sessionId: string, options: SessionOptions = {}): Promise<Agent> {
  const existing = sessions.get(sessionId)
  if (existing) return existing

  let messagesForInitial: ReturnType<typeof persistedChatMessagesToAgentMessages> | undefined
  try {
    const doc = await loadSession(sessionId)
    if (doc?.messages.length) {
      messagesForInitial = persistedChatMessagesToAgentMessages(doc.messages)
    }
  } catch {
    /* ignore — new Agent without history */
  }

  const wikiDir = options.wikiDir ?? getWikiDir()
  const localMessagesEnabled = areLocalMessageToolsEnabled()
  const tools = createAgentTools(wikiDir, {
    includeLocalMessageTools: localMessagesEnabled,
    timezone: options.timezone,
  })

  // Build system prompt with local date/time in the user's timezone
  const tz = options.timezone ?? 'UTC'
  const now = resolveEvalAnchoredNow() ?? new Date()
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)  // YYYY-MM-DD
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(now)
  const localWeekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now)
  // Compute the actual UTC offset for the user's timezone right now (accounts for DST)
  const gmtOffset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find(p => p.type === 'timeZoneName')?.value ?? ''  // e.g. "GMT-5"
  const utcOffset = gmtOffset.replace('GMT', 'UTC')  // e.g. "UTC-5"
  const dateTimeBlock = renderPromptTemplate('assistant/session-date-time.hbs', {
    localWeekday,
    localDate,
    localTime,
    tz,
    utcOffset,
  })
  let systemPrompt = `${buildBaseSystemPrompt(localMessagesEnabled, wikiDir)}

${dateTimeBlock}`

  if (options.firstChat) {
    systemPrompt += firstChatPromptSection(localMessagesEnabled)
  }

  if (options.context) {
    systemPrompt += `\n\n## Current file context\nThe user is viewing the following file(s). Use this as context for the conversation.\n\n${options.context}`
  }

  const skillLibrary = await formatSkillLibrarySection()
  if (skillLibrary) {
    systemPrompt += `\n\n${skillLibrary}`
  }

  // Model from env vars — pi-ai registry + Brain-only providers (e.g. mlx-local)
  const provider = (process.env.LLM_PROVIDER ?? 'openai') as KnownProvider
  const modelId = process.env.LLM_MODEL ?? 'gpt-5.4-mini'
  const model = resolveModel(provider, modelId)
  if (!model) {
    throw new Error(
      `[brain-app] Unknown LLM: LLM_PROVIDER=${provider} LLM_MODEL=${modelId} (not in pi-ai registry or mlx-local catalog)`,
    )
  }

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      ...(messagesForInitial?.length ? { messages: messagesForInitial } : {}),
    },
    onPayload: (params, m) => chainLlmOnPayload(params, m),
    getApiKey: (p: string) => resolveLlmApiKey(p),
    convertToLlm,
  })

  sessions.set(sessionId, agent)
  return agent
}

export function deleteSession(sessionId: string): boolean {
  const agent = sessions.get(sessionId)
  if (agent) {
    agent.abort()
    sessions.delete(sessionId)
    return true
  }
  return false
}

/** Abort and drop all in-memory chat agents (e.g. dev hard-reset after deleting persisted sessions). */
export function clearAllSessions(): void {
  for (const agent of sessions.values()) {
    agent.abort()
  }
  sessions.clear()
}
