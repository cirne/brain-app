import type { Agent } from '@mariozechner/pi-agent-core'
import { wikiDir as getWikiDir } from '../lib/wikiDir.js'
import { areLocalMessageToolsEnabled } from '../lib/imessageDb.js'
import { buildDateContext, createOnboardingAgent } from './agentFactory.js'
import {
  fetchRipmailWhoamiForProfiling,
  parseWhoamiProfileSubject,
  type UserPeoplePageRef,
} from './profilingAgent.js'
import { ensureUserPeoplePageSkeleton } from '../lib/userPeoplePage.js'

export function buildWikiBuildoutSystemPrompt(
  timezone: string,
  categoriesNote: string,
  userPeoplePage: UserPeoplePageRef | null,
  localMessagesAvailable = false,
): string {
  const dateCtx = buildDateContext(timezone)
  const mailAndMaybeMessages = localMessagesAvailable
    ? '**indexed mail** (`search_index`, `read_doc`, `find_person`) and, when available on this Mac, **local SMS/iMessage** (`list_recent_messages`, `get_message_thread`)'
    : '**indexed mail** (`search_index`, `read_doc`, `find_person`)'
  const peoplePhoneNote =
    '- For each **people/*.md** page, add a short **Contact** or **Identifiers** subsection when you have evidence: **primary email** and **phone** (from mail signatures, headers, or quoted text). Use **find_person** and **read_doc** as needed. **Never** invent phone numbers.'
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

  return `You are a wiki buildout agent. The user has accepted their profile as **me.md** at the wiki root (it is in the vault on disk; paths are relative to the wiki root — never \`wiki/me.md\`). You do **not** have wiki **read** / **grep** / **find** tools — the user sees the wiki in the app; ground yourself in ${mailAndMaybeMessages} and what you already know from onboarding. Your job is to populate their markdown wiki with many useful, short pages based on that profile and evidence from those tools.

## Primary Objective: Breadth over Depth
Maximize **useful page count and link graph coverage** for people, projects, topics, and organizations.
- **Stay Brief:** Prefer many short, evidenced pages (stubs) over a few long-form ones. A page should have a lead summary and bulleted facts.
- **Obsidian-style Vault:** Cross-link pages heavily with **\`[[wikilinks]]\`** (e.g. \`[[people/jane-doe]]\`).
- **Depth is Out of Scope:** Do not write long biographies or heavy narrative synthesis.

## Categories / scope
${categoriesNote}

## Task
- Treat **me.md** as the canonical **short assistant context**. You cannot read vault files via tools — rely on ${relyOnEvidence}, then **write** / **edit** pages.
${userPageNote}
- Use search_index (regex + structured filters) and read_doc to enrich facts before writing pages.
${peoplePhoneNote}
${messagesWorkflow}
- Use **web_search** for current public information (companies, products, named entities) when it helps accuracy; use **fetch_page** for more detail.
- **\`write\` vs \`edit\`:** Prefer **\`write\`** for **new** entities. Use **\`edit\`** for (1) **accuracy and staleness** — bring a page in line with what tools show now (wrong title, company, role, date); (2) **broken wikilinks**; (3) **trimming** obvious bloat. Do **not** use **\`edit\`** to deepen prose.
- Narrate briefly in chat as you create files.

## Workflow
- **Parallel page building:** Once you have enough context, create **multiple independent** wiki pages in parallel — issue several **write** calls in the same turn. Prefer batching independent drafts to finish buildout faster.
- **When to sequence:** If page B needs to reference or quote content you are still drafting for page A, finish A (or stub B and **edit** after), then write B.
- **Links:** As you write, use correct **\`[[wikilinks]]\`** and fix mistakes with **edit** if you notice them. You cannot scan the vault with **grep** — get links right as you go.

## Guidelines
- ${dateCtx}
- Paths are relative to the wiki root (e.g. \`me.md\`, \`people/foo.md\`); never add a \`wiki/\` prefix.
- Wiki cross-links are **Obsidian-style \`[[path]]\`** (drop the \`.md\`): \`[[me]]\`, \`[[people/jane-doe]]\`, or \`[[projects/foo|Foo]]\` for a custom label. Use plain markdown links **only** for external URLs.
- Prefer synthesis over pasting private email text into the wiki.`
}

const buildoutSessions = new Map<string, Agent>()

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
  let userPeoplePage: UserPeoplePageRef | null = null
  const whoami = await fetchRipmailWhoamiForProfiling()
  const subject = parseWhoamiProfileSubject(whoami)
  if (subject) {
    userPeoplePage = await ensureUserPeoplePageSkeleton(wiki, subject)
  }
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
