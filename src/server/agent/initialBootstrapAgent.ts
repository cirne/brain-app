/**
 * Unified initial assistant bootstrap: guided identity + calendar + first-impression mail insights,
 * served from `POST /api/chat` while onboarding machine state is `onboarding-agent`.
 */
import type { Agent } from '@mariozechner/pi-agent-core'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import type { OnboardingMailStatusPayload } from '@server/lib/onboarding/onboardingMailStatus.js'
import { loadSession } from '@server/lib/chat/chatStorage.js'
import { persistedChatMessagesToAgentMessages } from '@server/lib/chat/persistedChatToAgentMessages.js'
import {
  buildInterviewKickoffUserMessage,
  buildOnboardingInterviewSystemPrompt,
} from './onboardingInterviewAgent.js'
import { fetchRipmailWhoamiForProfiling } from './profilingAgent.js'
import {
  createOnboardingAgent,
  resolveOnboardingSessionTimezone,
} from './agentFactory.js'

const bootstrapSessions = new Map<string, Agent>()

export const DEFAULT_INITIAL_BOOTSTRAP_KICKOFF_INSTRUCTIONS =
  "Start the guided setup now. Before asking for the user's name: run mail search prioritizing email they sent (from their whoami address, recent window), read a few promising messages for signatures, then open with identity guesses. After identity is confirmed, follow the system prompt for Google calendar defaults (list_calendars / configure_source only when they have more than one synced Google calendar). Do not configure inbox rules in this flow. Do not ask them to name you. Do not mention phases, steps, or numbered sections to the user."

export function formatMailIndexFactsForBootstrap(mail: OnboardingMailStatusPayload): string {
  const lines: string[] = ['## Mail index snapshot (facts — cite honestly; do not invent dates)', '']
  lines.push(`- Mailbox configured: ${mail.configured}`)
  if (mail.indexedTotal != null) lines.push(`- Indexed messages (approx): ${mail.indexedTotal}`)
  if (mail.ftsReady != null) lines.push(`- FTS-ready count: ${mail.ftsReady}`)
  const from = mail.dateRange?.from
  const to = mail.dateRange?.to
  if (from || to) lines.push(`- Date span in index: ${from ?? '?'} → ${to ?? '?'}`)
  lines.push(`- refresh lane running: ${mail.refreshRunning}`)
  lines.push(`- backfill lane running: ${mail.backfillRunning}`)
  lines.push(`- pendingBackfill: ${mail.pendingBackfill}`)
  lines.push(`- syncRunning (legacy): ${mail.syncRunning}`)
  if (mail.indexingHint) lines.push(`- indexing hint: ${mail.indexingHint}`)
  lines.push('')
  lines.push(
    'Explain early what you can see today vs what may still be downloading in the background — grounded in these facts.',
  )
  return lines.join('\n')
}

export function buildInitialBootstrapSystemPrompt(
  timezone: string,
  ripmailWhoami: string,
  mailFactsBlock: string,
): string {
  const interview = buildOnboardingInterviewSystemPrompt(timezone, ripmailWhoami)
  const firstChat = renderPromptTemplate('assistant/first-chat.hbs', {
    includeLocalMessageCapabilities: false,
  })
  const sequencing = `

## Combined flow (strict order)
1. Complete **Identity** and **me.md** edits per the onboarding guide above.
2. Complete the **default Google calendar** step (or skip per those rules).
3. Only after identity and calendar are settled: deliver the **First conversation** section below — concrete observations from mail/wiki and actionable offers; use **suggest_reply_options** with a closing chip whose **submit** is exactly \`__brain_finish_conversation__\`.
4. Call **finish_conversation** once the user is satisfied or uses that chip — **before** your final closing line that turn (see onboarding guide).

`
  return `${interview}\n${sequencing}\n${firstChat}\n\n${mailFactsBlock}`
}

export async function buildInitialBootstrapKickoffUserMessage(): Promise<string> {
  const whoami = await fetchRipmailWhoamiForProfiling()
  return buildInterviewKickoffUserMessage(whoami, DEFAULT_INITIAL_BOOTSTRAP_KICKOFF_INSTRUCTIONS)
}

export async function getOrCreateInitialBootstrapSession(
  sessionId: string,
  options: {
    timezone?: string
    mailFactsBlock: string
  },
): Promise<Agent> {
  const existing = bootstrapSessions.get(sessionId)
  if (existing) return existing

  const whoami = await fetchRipmailWhoamiForProfiling()
  const tz = resolveOnboardingSessionTimezone('interview', options.timezone)
  const systemPrompt = buildInitialBootstrapSystemPrompt(tz, whoami, options.mailFactsBlock)

  let messagesForInitial: ReturnType<typeof persistedChatMessagesToAgentMessages> | undefined
  try {
    const doc = await loadSession(sessionId)
    if (doc?.messages.length) {
      messagesForInitial = persistedChatMessagesToAgentMessages(doc.messages)
    }
  } catch {
    /* ignore */
  }

  const agent = createOnboardingAgent(systemPrompt, wikiDir(), {
    variant: 'interview',
    timezone: options.timezone,
    initialMessages: messagesForInitial,
  })

  bootstrapSessions.set(sessionId, agent)
  return agent
}

export function deleteBootstrapSession(sessionId: string): boolean {
  const agent = bootstrapSessions.get(sessionId)
  if (agent) {
    agent.abort()
    bootstrapSessions.delete(sessionId)
    return true
  }
  return false
}

export function clearAllBootstrapSessions(): void {
  for (const agent of bootstrapSessions.values()) {
    agent.abort()
  }
  bootstrapSessions.clear()
}
