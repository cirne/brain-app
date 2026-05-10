import { Agent } from '@mariozechner/pi-agent-core'
import { resolveLlmApiKey } from '@server/lib/llm/resolveModel.js'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import Handlebars from 'handlebars'
import { createAgentTools } from './tools.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { wikiDir as getWikiDir, wikiToolsDir } from '@server/lib/wiki/wikiDir.js'
import { chainLlmOnPayloadNoThinking } from '@server/lib/llm/llmOnPayloadChain.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'
import { formatSkillLibrarySection } from '@server/lib/llm/skillRegistry.js'
import { loadSession } from '@server/lib/chat/chatStorage.js'
import { persistedChatMessagesToAgentMessages } from '@server/lib/chat/persistedChatToAgentMessages.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { buildRipmailSourcesPromptSection } from '@server/lib/ripmail/ripmailSourcesPromptSection.js'
import { B2B_ENABLED } from '@server/lib/features.js'
import { buildDateContext, requireStandardBrainLlm } from './agentFactory.js'
import { clearAllBootstrapSessions, deleteBootstrapSession } from './initialBootstrapAgent.js'

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

export function buildBaseSystemPrompt(
  includeLocalMessageCapabilities: boolean,
  wikiRoot: string,
  multiTenant = true,
): string {
  const meHint = meProfilePromptSection(wikiRoot)
  const assistantHint = assistantProfilePromptSection(wikiRoot)
  return renderPromptTemplate('assistant/base.hbs', {
    meHint: new Handlebars.SafeString(meHint),
    assistantHint: new Handlebars.SafeString(assistantHint),
    includeLocalMessageCapabilities,
    multiTenant,
    brainCollaborationEnabled: B2B_ENABLED,
  })
}

export interface SessionOptions {
  /** Pre-injected file context for file-grounded chat */
  context?: string
  /** Main assistant only: soft caveat when indexed mail is still “thin” (from Ripmail status). */
  mailCoverageCaveat?: string
  /** Override personal vault directory (`wikis/me/`) for prompts / profile files */
  wikiDir?: string
  /**
   * Override unified `wikis/` root used for find/grep + physical path joins (defaults to {@link wikiToolsDir}).
   * Almost always leave unset — tools and prompts assume one personal vault root + optional collaborator `@handle/` trees.
   */
  wikiToolsRoot?: string
  /** IANA timezone from the browser client (e.g. "America/Chicago") */
  timezone?: string
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

  const personalVault = options.wikiDir ?? getWikiDir()
  const localMessagesEnabled = areLocalMessageToolsEnabled()
  const tools = createAgentTools(personalVault, {
    includeLocalMessageTools: localMessagesEnabled,
    timezone: options.timezone,
    unifiedWikiRoot: options.wikiToolsRoot ?? wikiToolsDir(),
  })

  // Build system prompt with local date/time in the user's timezone
  const tz = options.timezone ?? 'UTC'
  const dateTimeBlock = buildDateContext(tz)
  let systemPrompt = `${buildBaseSystemPrompt(localMessagesEnabled, personalVault)}

${dateTimeBlock}`

  const ripmailSourcesSection = await buildRipmailSourcesPromptSection()
  if (ripmailSourcesSection) {
    systemPrompt += `\n\n${ripmailSourcesSection}`
  }

  if (options.context) {
    systemPrompt += `\n\n## Current file context\nThe user is viewing the following file(s). Use this as context for the conversation.\n\n${options.context}`
  }

  if (options.mailCoverageCaveat?.trim()) {
    systemPrompt += `\n\n${options.mailCoverageCaveat.trim()}`
  }

  const skillLibrary = await formatSkillLibrarySection()
  if (skillLibrary) {
    systemPrompt += `\n\n${skillLibrary}`
  }

  const model = requireStandardBrainLlm()

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
      thinkingLevel: 'off',
      ...(messagesForInitial?.length ? { messages: messagesForInitial } : {}),
    },
    onPayload: (params, m) => chainLlmOnPayloadNoThinking(params, m),
    getApiKey: (p: string) => resolveLlmApiKey(p),
    convertToLlm,
  })

  sessions.set(sessionId, agent)
  return agent
}

export function deleteSession(sessionId: string): boolean {
  const bootRemoved = deleteBootstrapSession(sessionId)
  const agent = sessions.get(sessionId)
  if (agent) {
    agent.abort()
    sessions.delete(sessionId)
    return true
  }
  return bootRemoved
}

/** Abort and drop all in-memory chat agents (e.g. dev hard-reset after deleting persisted sessions). */
export function clearAllSessions(): void {
  clearAllBootstrapSessions()
  for (const agent of sessions.values()) {
    agent.abort()
  }
  sessions.clear()
}
