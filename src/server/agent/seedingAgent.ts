import type { Agent } from '@mariozechner/pi-agent-core'
import { wikiDir as getWikiDir } from '../lib/wikiDir.js'
import { buildDateContext, createOnboardingAgent } from './agentFactory.js'

export function buildSeedingSystemPrompt(timezone: string, categoriesNote: string): string {
  const dateCtx = buildDateContext(timezone)
  return `You are a wiki seeding agent for onboarding. The user has accepted their profile as **me.md** at the wiki root (on disk that file lives under the wiki folder, but your read tool paths are relative to the wiki root). Your job is to populate their markdown wiki with useful pages based on that profile and email evidence.

## Categories / scope
${categoriesNote}

## Task
- Read **me.md** first with the read tool (path: \`me.md\` — not \`wiki/me.md\`).
- Use search_index (regex + structured filters) and read_doc to enrich facts before writing pages.
- Use **web_search** for current public information (companies, products, named entities) when it helps you write accurate wiki pages; use **fetch_page** to read full article text from a specific URL when you need more than search snippets.
- Create interlinked markdown pages under the wiki root (people/, projects/, etc. as appropriate). This is an **Obsidian-style vault** — cross-link pages with **\`[[wikilinks]]\`** (e.g. \`[[people/jane-doe]]\`, \`[[me]]\`, or \`[[projects/foo|Foo]]\` with a label). Do **not** use plain markdown \`[label](path.md)\` links between wiki pages — only \`[[ ]]\`. External URLs still use standard \`[label](https://…)\` markdown.
- **Do not** write a separate page about the **main user** (no duplicate profile under \`people/\` or elsewhere). **me.md** is already their profile — link to it as \`[[me]]\` from other pages when useful. Seed pages for **other** people, projects, and topics.
- Narrate briefly in chat as you create files.

## Workflow

## Chat title
- Call set_chat_title with a short title like "Seeding your wiki".
- **Build pages in parallel:** Once you have enough context to draft, create **independent** pages in **parallel** 
— issue **multiple tool calls in the same turn** (e.g. several **write**, or **read**/**grep** alongside **write**) for work that does not depend on another file's exact contents. Do not serialize page creation when you could batch; only sequence steps that truly depend on prior output.
- **Final link pass:** After the main pages exist, do a **final pass** focused on **internal wiki links** — use **grep** for \`\\[\\[\` to find every \`[[...]]\` wikilink, confirm each target resolves relative to the wiki root (use **find** if needed), and **edit** broken links (typos, casing, wrong relative paths). Convert any stray \`[label](path.md)\` cross-page links into \`[[path]]\` form. Treat this pass as required before you consider seeding complete.

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
  const agent = createOnboardingAgent(buildSeedingSystemPrompt(tz, categories), wiki)
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
