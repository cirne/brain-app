import { mkdir } from 'node:fs/promises'
import { Agent } from '@mariozechner/pi-agent-core'
import { getModel, type KnownProvider } from '@mariozechner/pi-ai'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import { createAgentTools } from './tools.js'
import { wikiDir as getWikiDir } from '../lib/wikiDir.js'
import { onboardingStagingWikiDir } from '../lib/onboardingState.js'
import { patchOpenAiReasoningNoneEffort, type OpenAiResponsesPayload } from '../lib/openAiResponsesPayload.js'
import { areImessageToolsEnabled } from '../lib/imessageDb.js'

const profilingSessions = new Map<string, Agent>()
const seedingSessions = new Map<string, Agent>()

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

function buildProfilingSystemPrompt(timezone: string): string {
  const dateCtx = buildDateContext(timezone)
  return `You are a profiling agent for onboarding. You know nothing about the user except what you can infer from their email (via ripmail tools).

## Task
- Use search_email, read_email, and list_inbox as needed to understand the user.
- Write a markdown user profile to **profile-draft.md** (relative path at wiki root). Use write or edit tools; keep it under ~100 lines unless the user asks for more.
- Synthesize — do not copy verbatim email bodies into the wiki file.
- Include frontmatter with type: user-profile and updated date when you finalize.
- Add a "## Suggested categories" section with bullet items (People, Projects, Interests, Areas, etc.) the seeding step can use — one line each.

## Chat title
- Call set_chat_title once with a short title like "Building your profile".

## Guidelines
- ${dateCtx}
- Paths in tools are relative to the onboarding draft root (e.g. profile-draft.md only).
- Do not use wiki_log or open tool unless necessary; focus on the draft file and email tools.
- Be concise in chat; put detail in profile-draft.md.`
}

function buildSeedingSystemPrompt(timezone: string, categoriesNote: string): string {
  const dateCtx = buildDateContext(timezone)
  return `You are a wiki seeding agent for onboarding. The user has accepted their profile at wiki/me.md (real wiki). Your job is to populate their markdown wiki with useful pages based on that profile and email evidence.

## Categories / scope
${categoriesNote}

## Task
- Read wiki/me.md first (read tool).
- Use search_email and read_email to enrich facts before writing pages.
- Create interlinked markdown pages under the wiki root (people/, projects/, etc. as appropriate).
- Narrate briefly in chat as you create files.
- Call wiki_log once at the end with a one-line summary of what you created.

## Chat title
- Call set_chat_title with a short title like "Seeding your wiki".

## Guidelines
- ${dateCtx}
- Paths are relative to the wiki root (e.g. people/foo.md); never add a "wiki/" prefix.
- Prefer synthesis over pasting private email text into the wiki.`
}

function createAgentWithPrompt(systemPrompt: string, wikiRoot: string, includeImessage: boolean): Agent {
  const tools = createAgentTools(wikiRoot, { includeImessageTools: includeImessage })
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
  const agent = createAgentWithPrompt(buildProfilingSystemPrompt(tz), staging, false)
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
  const agent = createAgentWithPrompt(buildSeedingSystemPrompt(tz, categories), wiki, areImessageToolsEnabled())
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
