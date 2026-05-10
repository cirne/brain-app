/**
 * Unified initial assistant bootstrap: guided identity + wiki-first proposals/writes + optional calendar,
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
  'Start the guided setup now. Before your first visible reply: (1) search_index for mail they sent from their whoami primary address (recent window, e.g. 180d) and read_mail_message on several promising sent messages for signatures, voice, projects, relationships; (2) search_index for active threads (e.g. multiple messages) to find important correspondents—for each people-page candidate, call find_person with their email address or a clear name query (ripmail who) to resolve canonical name and contact details; then read_mail_message on 2–3 messages from those threads; only keep candidates where you can write a substantive people page (role/relationship, what you work on together, contact details when present—not just high volume). Do not invent display names by stitching From-header fragments; use find_person output for names and titles; (3) identify recurring project/topic threads—only propose a project page if you can state what it is, the user\'s role, and collaborators from mail; (4) use web_search to confirm employers, companies, products, and roles implied by mail—do not guess facts you could verify online; for people with common names, include extra query terms from mail (company, domain, role, project, location) so results match the right person; (5) drop candidates where all you know is that they exchanged emails. Then open with a warm identity greeting (how they like to be named). After they confirm name: follow the system prompt—explain mail coverage using index facts, pitch the second brain wiki, propose 3–5 strong pages, write approved pages, one growth sentence, then Google calendar defaults (list_calendars / configure_source only when needed). Do not configure inbox rules. Do not ask them to name you. Do not mention phases, steps, or numbered sections to the user.'

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
  lines.push(`- pendingBackfill (gate): ${mail.pendingBackfill}`)
  lines.push(`- deepHistoricalPending (extended Gmail slice): ${mail.deepHistoricalPending}`)
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
1. Complete **Identity** and **me.md** edits per the onboarding guide above (mail recon before first visible reply).
2. After name is confirmed: explain mail coverage + pitch second brain wiki + **propose** high-quality pages per the **First conversation** section below — use **suggest_reply_options** (“Write all of them”, “Let me pick”, per-page).
3. **Write** approved wiki pages (quietly; summarize after).
4. One sentence on how the wiki grows over time (more mail, chat, sources like Google Drive).
5. Complete the **default Google calendar** step (or skip per onboarding guide — skip chat when exactly one calendar candidate per account).
6. **Do not** call **finish_conversation** right after finishing wiki + calendar. Offer **follow-up chips** and an **exit chip** (submit: \`__brain_finish_conversation__\`); stay available until the user **taps exit** or sends a **clear verbal sign-off**—only then call **finish_conversation** if needed (see onboarding guide **Ending the onboarding chat**). **Before** your final closing line that turn when you do call it.

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
