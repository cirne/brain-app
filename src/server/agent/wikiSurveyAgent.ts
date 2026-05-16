import type { Agent } from '@earendil-works/pi-agent-core'
import Handlebars from 'handlebars'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { buildDateContext, createOnboardingAgent, resolveOnboardingSessionTimezone } from './agentFactory.js'

export function buildWikiSurveySystemPrompt(timezone: string): string {
  const dateCtx = buildDateContext(timezone)
  return renderPromptTemplate('wiki-survey/system.hbs', {
    dateContext: new Handlebars.SafeString(dateCtx),
  })
}

const surveySessions = new Map<string, Agent>()

export async function getOrCreateWikiSurveyAgent(sessionId: string, options: { timezone?: string } = {}): Promise<Agent> {
  const existing = surveySessions.get(sessionId)
  if (existing) return existing

  const tz = resolveOnboardingSessionTimezone('buildout', options.timezone)
  const wiki = wikiDir()
  const agent = createOnboardingAgent(buildWikiSurveySystemPrompt(tz), wiki, {
    variant: 'survey',
    timezone: options.timezone,
  })
  surveySessions.set(sessionId, agent)
  return agent
}

export function deleteWikiSurveySession(sessionId: string): boolean {
  const a = surveySessions.get(sessionId)
  if (a) {
    a.abort()
    surveySessions.delete(sessionId)
    return true
  }
  return false
}

export function clearAllWikiSurveySessions(): void {
  for (const agent of surveySessions.values()) {
    agent.abort()
  }
  surveySessions.clear()
}
