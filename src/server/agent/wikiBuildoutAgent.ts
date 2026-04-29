import type { Agent } from '@mariozechner/pi-agent-core'
import Handlebars from 'handlebars'
import { wikiDir as getWikiDir } from '@server/lib/wiki/wikiDir.js'
import { areLocalMessageToolsEnabled } from '@server/lib/apple/imessageDb.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'
import { buildDateContext, createOnboardingAgent, resolveOnboardingSessionTimezone } from './agentFactory.js'
import type { UserPeoplePageRef } from './profilingAgent.js'
import { ensureWikiVaultScaffoldForBuildout } from '@server/lib/wiki/wikiVaultScaffold.js'

export { ensureWikiVaultScaffoldForBuildout }

/**
 * First-run scope block for the buildout system prompt: aligns with **starter wiki under `assets/starter-wiki/`**
 * (copied at seed time) — folder layout, `template.md` per typed area, landing `index.md` files.
 */
export function buildWikiBuildoutFirstRunScopeNote(): string {
  return [
    'The vault follows the **starter layout** (already on disk after seeding):',
    '- **Root:** `index.md` (nav hub), `me.md` (short profile / assistant context), `assistant.md` if present. Wiki tool mutations append to structured **`wiki-edits.jsonl`** under **`$BRAIN_HOME/var/`** (server-side — not a markdown file you edit).',
    '- **Typed folders** — each includes a **`template.md`** describing the intended shape of pages in that folder. Read it before writing a new page; use it as a starting scaffold, not a rigid format.',
    '- **Folder landing pages** — several areas ship a lightweight `index.md`. Keep those and vault-root `index.md` in sync with **`[[wikilinks]]`** when you add pages.',
    '- **Scope:** People go in `people/`, initiatives in `projects/`, durable themes in `topics/`, scratch and dated material in `notes/`, trips in `travel/`. Prefer **`edit`** on an existing file over a second file for the same entity; new filenames use **kebab-case**.',
    '- **New top-level areas** only when you repeatedly need a new class of page — then add a `template.md` + landing page consistent with the starter folders.',
  ].join('\n')
}

/** Injected on **subsequent** buildout runs — no starter-template hand-holding. */
export function buildWikiBuildoutReturningScopeNote(): string {
  return [
    'This is a **later** enrichment pass. Each run’s user message includes **injected context**: your profile, assistant charter, and a **vault manifest** listing existing pages — **treat that as the map** of what is already on disk. Prefer **`edit`** when the same entity already has a path there.',
    '- **`write`** only for **new** entities with clear evidence from mail/messages/web. Match section style and filename conventions implied by paths in the manifest.',
    '- Keep **`index.md`** and folder landing pages useful with **`[[wikilinks]]`** as you add or fix pages.',
  ].join('\n')
}

export type BuildWikiBuildoutSystemPromptOptions = {
  localMessagesAvailable?: boolean
  /**
   * First lap after onboarding / fresh state: include starter-template scope from the seeded wiki.
   * Later laps: {@link buildWikiBuildoutReturningScopeNote} only for the scope section.
   * @default true when omitted (e.g. evals).
   */
  isFirstBuildoutRun?: boolean
}

export function buildWikiBuildoutSystemPrompt(
  timezone: string,
  userPeoplePage: UserPeoplePageRef | null,
  options: BuildWikiBuildoutSystemPromptOptions = {},
): string {
  const isFirstBuildoutRun = options.isFirstBuildoutRun !== false
  const dateCtx = buildDateContext(timezone)
  const mailAndMaybeMessages = options.localMessagesAvailable
    ? '**indexed mail** (`search_index`, `read_email`, `find_person`) and, when available on this Mac, **local SMS/iMessage** (`list_recent_messages`, `get_message_thread`)'
    : '**indexed mail** (`search_index`, `read_email`, `find_person`)'
  const peoplePhoneNote =
    '- For each **people/*.md** page, add a short **Contact** or **Identifiers** subsection when you have evidence: **primary email** and **phone** (from mail signatures, headers, or quoted text). Use **find_person** and **read_email** as needed. **Never** invent phone numbers.'
  const messagesWorkflow = options.localMessagesAvailable
    ? [
        '',
        '- **Local Messages (optional):** When a person matches a thread, you may use **list_recent_messages** / **get_message_thread** to discover or confirm a **chat_identifier**. Only record phone numbers that appear in **tool output** or mail—same privacy bar as mail evidence.',
      ].join('\n')
    : ''
  const relyOnEvidence = options.localMessagesAvailable
    ? 'mail and local Message tools (see above) + your task context'
    : 'mail tools + your task context'
  const userPageNote = userPeoplePage
    ? [
        `- A **skeletal long-form page for the account holder** already exists at \`${userPeoplePage.relativePath}\` (wikilink \`[[people/${userPeoplePage.slug}]]\`). **Keep it compact**: link to \`[[me]]\` for short assistant context; add 3–8 bullet facts max from mail + web — this is NOT the place for a long biography.`,
        `- Build out **other** people, projects, and topic pages as usual; link the account holder to \`[[me]]\` and to \`[[people/${userPeoplePage.slug}]]\` where appropriate.`,
      ].join('\n')
    : `- If you infer a \`people/[slug].md\` for the account holder from mail, you may create it; otherwise focus on other people and topics.`

  const firstRunScopeNote = buildWikiBuildoutFirstRunScopeNote()
  const returningRunScopeNote = buildWikiBuildoutReturningScopeNote()

  return renderPromptTemplate('wiki-buildout/system.hbs', {
    mailAndMaybeMessages: new Handlebars.SafeString(mailAndMaybeMessages),
    localMessagesAvailable: options.localMessagesAvailable ?? false,
    isFirstBuildoutRun,
    firstRunScopeNote: new Handlebars.SafeString(firstRunScopeNote),
    returningRunScopeNote: new Handlebars.SafeString(returningRunScopeNote),
    relyOnEvidence: new Handlebars.SafeString(relyOnEvidence),
    userPageNote: new Handlebars.SafeString(userPageNote),
    peoplePhoneNote: new Handlebars.SafeString(peoplePhoneNote),
    messagesWorkflow: new Handlebars.SafeString(messagesWorkflow),
    dateContext: new Handlebars.SafeString(dateCtx),
  })
}

const buildoutSessions = new Map<string, Agent>()

export async function getOrCreateWikiBuildoutAgent(
  sessionId: string,
  options: { timezone?: string; isFirstBuildoutRun?: boolean } = {},
): Promise<Agent> {
  const existing = buildoutSessions.get(sessionId)
  if (existing) return existing

  const tz = resolveOnboardingSessionTimezone('buildout', options.timezone)
  const wiki = getWikiDir()
  const userPeoplePage = await ensureWikiVaultScaffoldForBuildout(wiki)
  const localMessagesAvailable = areLocalMessageToolsEnabled()
  const isFirstBuildoutRun = options.isFirstBuildoutRun ?? true
  const agent = createOnboardingAgent(
    buildWikiBuildoutSystemPrompt(tz, userPeoplePage, {
      localMessagesAvailable,
      isFirstBuildoutRun,
    }),
    wiki,
    { variant: 'buildout', timezone: options.timezone },
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
