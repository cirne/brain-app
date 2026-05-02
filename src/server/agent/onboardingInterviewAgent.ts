import Handlebars from 'handlebars'
import type { Agent } from '@mariozechner/pi-agent-core'
import { wikiToolsDir } from '@server/lib/wiki/wikiDir.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { fetchRipmailWhoamiForProfiling, parseWhoamiProfileSubject } from './profilingAgent.js'
import { createOnboardingAgent, resolveOnboardingSessionTimezone } from './agentFactory.js'

/**
 * First user turn for guided onboarding: embed a **fresh** `ripmail whoami` payload before
 * the kickoff instructions so the model grounds identity in CLI output, not only the address.
 */
export function buildInterviewKickoffUserMessage(whoamiRaw: string, instructions: string): string {
  const who = whoamiRaw.trim() || '(ripmail whoami produced no output.)'
  const inst = instructions.trim()
  if (!inst) {
    return (
      '### ripmail whoami (source of truth for mailbox identity)\n\n```\n' + who + '\n```\n'
    )
  }
  return (
    '### ripmail whoami (fresh — source of truth for mailbox identity; do not infer display name only from an email address)\n\n' +
    '```\n' +
    who +
    '\n```\n\n' +
    '### What to do now\n\n' +
    inst
  )
}

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

/** In-memory interview agent when present — does **not** create or fetch whoami. */
export function peekOnboardingInterviewAgent(sessionId: string): Agent | undefined {
  return interviewSessions.get(sessionId)
}

export async function getOrCreateOnboardingInterviewAgent(
  sessionId: string,
  options: { timezone?: string } = {},
): Promise<Agent> {
  const existing = interviewSessions.get(sessionId)
  if (existing) return existing
  const ripmailWhoami = await fetchRipmailWhoamiForProfiling()
  const tz = resolveOnboardingSessionTimezone('interview', options.timezone)
  const systemPrompt = buildOnboardingInterviewSystemPrompt(tz, ripmailWhoami)
  const agent = createOnboardingAgent(systemPrompt, wikiToolsDir(), {
    variant: 'interview',
    timezone: options.timezone,
  })
  interviewSessions.set(sessionId, agent)
  return agent
}

export function deleteInterviewSession(sessionId: string): void {
  interviewSessions.delete(sessionId)
}

export function clearAllInterviewSessions(): void {
  interviewSessions.clear()
}
