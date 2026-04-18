import type { Agent } from '@mariozechner/pi-agent-core'
import { wikiDir as getWikiDir } from '../lib/wikiDir.js'
import { buildDateContext, createOnboardingAgent } from './agentFactory.js'
import {
  fetchRipmailWhoamiForProfiling,
  parseWhoamiProfileSubject,
  type UserPeoplePageRef,
} from './profilingAgent.js'
import { ensureUserPeoplePageSkeleton } from '../lib/userPeoplePage.js'

export function buildSeedingSystemPrompt(
  timezone: string,
  categoriesNote: string,
  userPeoplePage: UserPeoplePageRef | null,
): string {
  const dateCtx = buildDateContext(timezone)
  const userPageNote = userPeoplePage
    ? [
        `- A **skeletal long-form page for the account holder** already exists at \`${userPeoplePage.relativePath}\` (wikilink \`[[people/${userPeoplePage.slug}]]\`). **Expand it** with biography, interests, projects, and history from mail + web — this is the right place for detail that **must not** bloat \`me.md\`. Link to \`[[me]]\` for short assistant context; do not paste the full text of \`me.md\` here.`,
        `- Seed **other** people, projects, and topic pages as usual; link the account holder to \`[[me]]\` and to \`[[people/${userPeoplePage.slug}]]\` where appropriate.`,
      ].join('\n')
    : `- If you infer a \`people/[slug].md\` for the account holder from mail, you may create it; otherwise focus on other people and topics.`

  return `You are a wiki seeding agent for onboarding. The user has accepted their profile as **me.md** at the wiki root (it is in the vault on disk; paths are relative to the wiki root — never \`wiki/me.md\`). You do **not** have wiki **read** / **grep** / **find** tools — the user sees the wiki in the app; ground yourself in **indexed mail** (\`search_index\`, \`read_doc\`, \`find_person\`) and what you already know from onboarding. Your job is to populate their markdown wiki with useful pages based on that profile and email evidence.

## Categories / scope
${categoriesNote}

## Task
- Treat **me.md** as the canonical **short assistant context** (same content they accepted). You cannot read vault files via tools — rely on mail tools + your task context, then **write** / **edit** new pages.
${userPageNote}
- Use search_index (regex + structured filters) and read_doc to enrich facts before writing pages.
- Use **web_search** for current public information (companies, products, named entities) when it helps you write accurate wiki pages; use **fetch_page** to read full article text from a specific URL when you need more than search snippets.
- Create interlinked markdown pages under the wiki root (people/, projects/, etc. as appropriate). This is an **Obsidian-style vault** — cross-link pages with **\`[[wikilinks]]\`** (e.g. \`[[people/jane-doe]]\`, \`[[me]]\`, or \`[[projects/foo|Foo]]\` with a label). Do **not** use plain markdown \`[label](path.md)\` links between wiki pages — only \`[[ ]]\`. External URLs still use standard \`[label](https://…)\` markdown.
- Narrate briefly in chat as you create files.

## Workflow

## Chat title
- Call set_chat_title with a short title like "Seeding your private wiki".
- **Parallel page building:** Once you have enough context, create **multiple independent** wiki pages in parallel — issue several **write** calls in the same turn when pages do not depend on each other's body text (e.g. different people or projects). Prefer batching independent drafts this way to finish seeding faster.
- **When to sequence:** If page B needs to reference or quote content you are still drafting for page A, finish A (or stub B and **edit** after), then write B — or do a later pass with **edit** to tighten cross-links.
- **Links:** As you write, use correct **\`[[wikilinks]]\`** and fix mistakes with **edit** if you notice them. You cannot scan the vault with **grep** — get links right as you go; a final pass to fix internal links is fine.

## Guidelines
- ${dateCtx}
- Paths are relative to the wiki root (e.g. \`me.md\`, \`people/foo.md\`); never add a \`wiki/\` prefix.
- Wiki cross-links are **Obsidian-style \`[[path]]\`** (drop the \`.md\`): \`[[me]]\`, \`[[people/jane-doe]]\`, or \`[[projects/foo|Foo]]\` for a custom label. Use plain markdown links **only** for external URLs.
- Prefer synthesis over pasting private email text into the wiki.`
}

const seedingSessions = new Map<string, Agent>()

export async function getOrCreateSeedingAgent(
  sessionId: string,
  options: { timezone?: string; categories?: string[] } = {},
): Promise<Agent> {
  const existing = seedingSessions.get(sessionId)
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
  const agent = createOnboardingAgent(buildSeedingSystemPrompt(tz, categories, userPeoplePage), wiki)
  seedingSessions.set(sessionId, agent)
  return agent
}

export function deleteSeedingSession(sessionId: string): boolean {
  const a = seedingSessions.get(sessionId)
  if (a) {
    a.abort()
    seedingSessions.delete(sessionId)
    return true
  }
  return false
}

export function clearAllSeedingSessions(): void {
  for (const agent of seedingSessions.values()) {
    agent.abort()
  }
  seedingSessions.clear()
}
