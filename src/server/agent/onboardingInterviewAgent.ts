import Handlebars from 'handlebars'
import type { Agent } from '@mariozechner/pi-agent-core'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { fetchRipmailWhoamiForProfiling, parseWhoamiProfileSubject } from './profilingAgent.js'
import { createOnboardingAgent } from './agentFactory.js'

export function buildOnboardingInterviewSystemPrompt(timezone: string, ripmailWhoami: string): string {
  const tz = timezone || 'UTC'
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  const localTime = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date())
  const who = parseWhoamiProfileSubject(ripmailWhoami)
  const name = who?.displayName ?? 'the account holder'
  const email = who?.primaryEmail ?? '(see whoami)'
  return renderPromptTemplate('onboarding-agent/system.hbs', {
    todayYmd,
    localTime,
    tz,
    name,
    email,
    ripmailWhoami: new Handlebars.SafeString(ripmailWhoami),
  })
}

const interviewSessions = new Map<string, Agent>()

export async function getOrCreateOnboardingInterviewAgent(
  sessionId: string,
  options: { timezone?: string } = {},
): Promise<Agent> {
  const existing = interviewSessions.get(sessionId)
  if (existing) return existing
  const ripmailWhoami = await fetchRipmailWhoamiForProfiling()
  const tz = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const systemPrompt = buildOnboardingInterviewSystemPrompt(tz, ripmailWhoami)
  const wikiRoot = wikiDir()
  const agent = createOnboardingAgent(systemPrompt, wikiRoot, { variant: 'interview' })
  interviewSessions.set(sessionId, agent)
  return agent
}

export function deleteInterviewSession(sessionId: string): void {
  interviewSessions.delete(sessionId)
}

export function clearAllInterviewSessions(): void {
  interviewSessions.clear()
}
