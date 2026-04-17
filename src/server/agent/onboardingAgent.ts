import { mkdir } from 'node:fs/promises'
import { Agent } from '@mariozechner/pi-agent-core'
import { getModel, type KnownProvider } from '@mariozechner/pi-ai'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import { createAgentTools } from './tools.js'
import { wikiDir as getWikiDir } from '../lib/wikiDir.js'
import { onboardingStagingWikiDir } from '../lib/onboardingState.js'
import { ripmailBin } from '../lib/onboardingMailStatus.js'
import { execRipmailAsync } from '../lib/ripmailExec.js'
import { patchOpenAiReasoningNoneEffort, type OpenAiResponsesPayload } from '../lib/openAiResponsesPayload.js'

const MAX_WHOAMI_PROMPT_CHARS = 8000

/** Runs `ripmail whoami` with the same env as the rest of the app; result is embedded in the profiling prompt. */
export async function fetchRipmailWhoamiForProfiling(): Promise<string> {
  try {
    const { stdout } = await execRipmailAsync(`${ripmailBin()} whoami`, { timeout: 10000 })
    let s = stdout.trim()
    if (!s) return '(ripmail whoami produced no output.)'
    if (s.length > MAX_WHOAMI_PROMPT_CHARS) {
      s = `${s.slice(0, MAX_WHOAMI_PROMPT_CHARS)}…`
    }
    return s
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `(Could not run ripmail whoami: ${msg})`
  }
}

const profilingSessions = new Map<string, Agent>()
const seedingSessions = new Map<string, Agent>()

/** Subset of `createAgentTools` for profiling + seeding (no inbox rules, drafts, calendar, etc.). */
export const ONBOARDING_OMIT_TOOL_NAMES: readonly string[] = [
  'inbox_rules',
  'archive_emails',
  'draft_email',
  'edit_draft',
  'send_draft',
  'get_calendar_events',
  'get_youtube_transcript',
  'open',
  'list_recent_messages',
  'get_message_thread',
  'list_sources',
  'source_status',
  'add_files_source',
  'edit_files_source',
  'remove_files_source',
  'reindex_files_source',
]

function buildDateContext(timezone: string): string {
  const tz = timezone || 'UTC'
  const now = new Date()
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(now)
  const localWeekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now)
  const gmtOffset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find(p => p.type === 'timeZoneName')?.value ?? ''
  const utcOffset = gmtOffset.replace('GMT', 'UTC')
  return `Today is ${localWeekday}, ${localDate} (${localTime} ${tz}, ${utcOffset}).`
}

/** System prompt for the onboarding profiling agent (writes staging me.md → copied to wiki/me.md on accept). Exported for tests. */
export function buildProfilingSystemPrompt(timezone: string, ripmailWhoami: string): string {
  const dateCtx = buildDateContext(timezone)
  const tz = timezone || 'UTC'
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  return `You are a profiling agent for onboarding. **Definitive identity** for this ripmail account is below (\`ripmail whoami\`). Use it as ground truth for who this onboarding is for; you may still infer additional detail from email (via ripmail tools).

## Identity (authoritative)
Treat this output as **definitive** for which account / person this assistant is for (e.g. primary email, display name if present):

\`\`\`
${ripmailWhoami}
\`\`\`

## Task
- **First:** call **find_person** with an **empty query** once — this runs \`ripmail who\` and lists who the user emails most (top contacts by frequency). Then use **find_person** again for specific people you want to understand better.
- Use search_index (regex pattern + optional \`from\`/\`after\`/etc.), read_doc, and list_inbox sparingly — only enough to fill the sections below. Do not turn this into a research project.
- Write **me.md** at the wiki root (relative path \`me.md\` only) with the **write** or **edit** tools — **same filename** as the real profile file.

## What me.md is for here
- Your tools see an onboarding staging wiki root; the file is **me.md** there too. On accept, it is copied to **wiki/me.md**. The main assistant treats that file as the user's identity summary in context — similar to a short system-prompt blurb.
- **Keep it concise:** aim for **about 25–45 lines** including frontmatter (hard cap **~55 lines** unless the user explicitly asks for more). This is **not** a dossier, biography, or inbox report — **no long prose**, no pasted email bodies, no exhaustive timelines.

## Required structure (omit a section only if you truly have nothing)
Use YAML frontmatter: \`type: user-profile\` and \`updated: ${todayYmd}\` (user's local calendar date).

Then markdown sections in this order — **tight bullets**, one line per item where possible:
1. **#** Title line — preferred name or how to address the user (or "User" if unknown).
2. **## Name** — full / preferred name if known; otherwise skip or say unknown.
3. **## Key people** — people they actually correspond with (from \`who\`/threads): name + few words (relationship or topic). Cap at **~8** unless clearly needed.
4. **## Interests** — hobbies, causes, topics that show up repeatedly.
5. **## Projects & work** — employer, role, products, or projects — **short**, no org charts.
6. **## Contact** — email, phone, or other channels **only** if clearly visible in signatures or headers; **do not invent or guess**.

## Chat title
- Call set_chat_title once with a short title like "Building your profile".

## Guidelines
- ${dateCtx}
- Paths in tools are relative to the onboarding staging root — for this task use **me.md** only (no other filenames unless the user asks).
- Focus on the draft file, find_person, and other email tools.
- Be brief in chat; the file should carry the essentials, not a wall of text.`
}

/** Exported for tests. */
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

function createAgentWithPrompt(systemPrompt: string, wikiRoot: string): Agent {
  const tools = createAgentTools(wikiRoot, {
    includeLocalMessageTools: false,
    omitToolNames: ONBOARDING_OMIT_TOOL_NAMES,
  })
  const provider = (process.env.LLM_PROVIDER ?? 'anthropic') as KnownProvider
  const modelId = process.env.LLM_MODEL ?? 'claude-sonnet-4-20250514'
  const model = getModel(provider, modelId as never)

  return new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
    },
    onPayload: (params, m) => patchOpenAiReasoningNoneEffort(params as OpenAiResponsesPayload, m),
    getApiKey: (p: string) => {
      const envKey = `${p.toUpperCase()}_API_KEY`
      return process.env[envKey]
    },
    convertToLlm,
  })
}

export async function getOrCreateProfilingAgent(sessionId: string, options: { timezone?: string } = {}): Promise<Agent> {
  const existing = profilingSessions.get(sessionId)
  if (existing) return existing

  const tz = options.timezone ?? 'UTC'
  const staging = onboardingStagingWikiDir()
  await mkdir(staging, { recursive: true })
  const whoami = await fetchRipmailWhoamiForProfiling()
  const agent = createAgentWithPrompt(buildProfilingSystemPrompt(tz, whoami), staging)
  profilingSessions.set(sessionId, agent)
  return agent
}

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
  const agent = createAgentWithPrompt(buildSeedingSystemPrompt(tz, categories), wiki)
  seedingSessions.set(sessionId, agent)
  return agent
}

export function deleteProfilingSession(sessionId: string): boolean {
  const a = profilingSessions.get(sessionId)
  if (a) {
    a.abort()
    profilingSessions.delete(sessionId)
    return true
  }
  return false
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

/** Abort and drop profiling/seeding agents (e.g. dev hard-reset). */
export function clearAllOnboardingAgentSessions(): void {
  for (const agent of profilingSessions.values()) {
    agent.abort()
  }
  profilingSessions.clear()
  for (const agent of seedingSessions.values()) {
    agent.abort()
  }
  seedingSessions.clear()
}
