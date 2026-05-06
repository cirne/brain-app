import type { Agent } from '@mariozechner/pi-agent-core'
import Handlebars from 'handlebars'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { buildDateContext, createOnboardingAgent, resolveOnboardingSessionTimezone } from './agentFactory.js'
import { ensureWikiVaultScaffoldForBuildout } from '@server/lib/wiki/wikiVaultScaffold.js'
import {
  WIKI_BOOTSTRAP_MAX_PEOPLE,
  WIKI_BOOTSTRAP_MAX_PROJECTS_AND_TOPICS,
  WIKI_BOOTSTRAP_MAX_TRAVEL_ARTIFACTS,
} from '@shared/wikiBootstrap.js'

export { ensureWikiVaultScaffoldForBuildout }

export function buildWikiBootstrapSystemPrompt(timezone: string): string {
  const dateCtx = buildDateContext(timezone)
  return renderPromptTemplate('wiki-bootstrap/system.hbs', {
    maxPeople: WIKI_BOOTSTRAP_MAX_PEOPLE,
    maxProjectsAndTopics: WIKI_BOOTSTRAP_MAX_PROJECTS_AND_TOPICS,
    maxTravelArtifacts: WIKI_BOOTSTRAP_MAX_TRAVEL_ARTIFACTS,
    dateContext: new Handlebars.SafeString(dateCtx),
  })
}

const bootstrapSessions = new Map<string, Agent>()

export async function getOrCreateWikiBootstrapAgent(
  sessionId: string,
  options: { timezone?: string } = {},
): Promise<Agent> {
  const existing = bootstrapSessions.get(sessionId)
  if (existing) return existing

  const tz = resolveOnboardingSessionTimezone('bootstrap', options.timezone)
  const wiki = wikiDir()
  await ensureWikiVaultScaffoldForBuildout(wiki)
  const localMessagesAvailable = areLocalMessageToolsEnabled()
  const systemPrompt = buildWikiBootstrapSystemPrompt(tz)
  const extraOmit = localMessagesAvailable ? [] : (['list_recent_messages', 'get_message_thread'] as const)
  const agent = createOnboardingAgent(systemPrompt, wiki, {
    variant: 'bootstrap',
    timezone: options.timezone,
    ...(extraOmit.length ? { extraOmitToolNames: extraOmit } : {}),
  })
  bootstrapSessions.set(sessionId, agent)
  return agent
}

export function deleteWikiBootstrapSession(sessionId: string): boolean {
  const a = bootstrapSessions.get(sessionId)
  if (a) {
    a.abort()
    bootstrapSessions.delete(sessionId)
    return true
  }
  return false
}
