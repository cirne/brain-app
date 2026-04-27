import type { Agent } from '@mariozechner/pi-agent-core'
import Handlebars from 'handlebars'
import { wikiDir as getWikiDir } from '@server/lib/wiki/wikiDir.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { buildDateContext, createOnboardingAgent } from './agentFactory.js'
import {
  fetchRipmailWhoamiForProfiling,
  parseWhoamiProfileSubject,
  type UserPeoplePageRef,
} from './profilingAgent.js'
import { ensureUserPeoplePageSkeleton } from '@server/lib/wiki/userPeoplePage.js'
import { ensureWikiIndexMdStub } from '@server/lib/wiki/wikiIndexStub.js'

export function buildWikiBuildoutSystemPrompt(
  timezone: string,
  categoriesNote: string,
  userPeoplePage: UserPeoplePageRef | null,
  localMessagesAvailable = false,
): string {
  const dateCtx = buildDateContext(timezone)
  const mailAndMaybeMessages = localMessagesAvailable
    ? '**indexed mail** (`search_index`, `read_email`, `find_person`) and, when available on this Mac, **local SMS/iMessage** (`list_recent_messages`, `get_message_thread`)'
    : '**indexed mail** (`search_index`, `read_email`, `find_person`)'
  const peoplePhoneNote =
    '- For each **people/*.md** page, add a short **Contact** or **Identifiers** subsection when you have evidence: **primary email** and **phone** (from mail signatures, headers, or quoted text). Use **find_person** and **read_email** as needed. **Never** invent phone numbers.'
  const messagesWorkflow = localMessagesAvailable
    ? [
        '',
        '- **Local Messages (optional):** When a person matches a thread, you may use **list_recent_messages** / **get_message_thread** to discover or confirm a **chat_identifier**. Only record phone numbers that appear in **tool output** or mail—same privacy bar as mail evidence.',
      ].join('\n')
    : ''
  const relyOnEvidence = localMessagesAvailable
    ? 'mail and local Message tools (see above) + your task context'
    : 'mail tools + your task context'
  const userPageNote = userPeoplePage
    ? [
        `- A **skeletal long-form page for the account holder** already exists at \`${userPeoplePage.relativePath}\` (wikilink \`[[people/${userPeoplePage.slug}]]\`). **Keep it compact**: link to \`[[me]]\` for short assistant context; add 3–8 bullet facts max from mail + web — this is NOT the place for a long biography.`,
        `- Build out **other** people, projects, and topic pages as usual; link the account holder to \`[[me]]\` and to \`[[people/${userPeoplePage.slug}]]\` where appropriate.`,
      ].join('\n')
    : `- If you infer a \`people/[slug].md\` for the account holder from mail, you may create it; otherwise focus on other people and topics.`

  return renderPromptTemplate('wiki-buildout/system.hbs', {
    mailAndMaybeMessages: new Handlebars.SafeString(mailAndMaybeMessages),
    localMessagesAvailable,
    categoriesNote: new Handlebars.SafeString(categoriesNote),
    relyOnEvidence: new Handlebars.SafeString(relyOnEvidence),
    userPageNote: new Handlebars.SafeString(userPageNote),
    peoplePhoneNote: new Handlebars.SafeString(peoplePhoneNote),
    messagesWorkflow: new Handlebars.SafeString(messagesWorkflow),
    dateContext: new Handlebars.SafeString(dateCtx),
  })
}

const buildoutSessions = new Map<string, Agent>()

/**
 * Ensures account-holder `people/…` skeleton (when whoami resolves) and vault-root `index.md`
 * stub. Call at the start of every enrich and cleanup lap (and when creating a new buildout agent)
 * so `index.md` exists before any `edit` (or cleanup `read`) touches it.
 * Does not overwrite an existing `index.md`. Returns the account-holder people page when present.
 */
export async function ensureWikiVaultScaffoldForBuildout(
  wikiRoot: string,
): Promise<UserPeoplePageRef | null> {
  let userPeoplePage: UserPeoplePageRef | null = null
  const whoami = await fetchRipmailWhoamiForProfiling()
  const subject = parseWhoamiProfileSubject(whoami)
  if (subject) {
    try {
      userPeoplePage = await ensureUserPeoplePageSkeleton(wikiRoot, subject)
    } catch (e) {
      console.error('[wiki] ensureUserPeoplePageSkeleton failed (continuing to index.md stub):', e)
    }
  }
  const peopleWikilink =
    userPeoplePage?.relativePath.replace(/\.md$/i, '') ?? undefined
  await ensureWikiIndexMdStub(wikiRoot, { accountHolderPeopleWikilink: peopleWikilink })
  return userPeoplePage
}

export async function getOrCreateWikiBuildoutAgent(
  sessionId: string,
  options: { timezone?: string; categories?: string[] } = {},
): Promise<Agent> {
  const existing = buildoutSessions.get(sessionId)
  if (existing) return existing

  const tz = options.timezone ?? 'UTC'
  const categories = options.categories?.length
    ? options.categories.map(c => `- ${c}`).join('\n')
    : '- (No extra filter — use profile and email to infer scope.)'
  const wiki = getWikiDir()
  const userPeoplePage = await ensureWikiVaultScaffoldForBuildout(wiki)
  const localMessagesAvailable = areLocalMessageToolsEnabled()
  const agent = createOnboardingAgent(
    buildWikiBuildoutSystemPrompt(tz, categories, userPeoplePage, localMessagesAvailable),
    wiki,
    { variant: 'buildout' },
  )
  buildoutSessions.set(sessionId, agent)
  return agent
}

export function deleteWikiBuildoutSession(sessionId: string): boolean {
  const a = buildoutSessions.get(sessionId)
  if (a) {
    a.abort()
    buildoutSessions.delete(sessionId)
    return true
  }
  return false
}

export function clearAllWikiBuildoutSessions(): void {
  for (const agent of buildoutSessions.values()) {
    agent.abort()
  }
  buildoutSessions.clear()
}
