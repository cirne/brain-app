import { Agent } from '@mariozechner/pi-agent-core'
import { getModel, type KnownProvider } from '@mariozechner/pi-ai'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import { createAgentTools } from './tools.js'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { wikiDir as getWikiDir } from '../lib/wikiDir.js'
import { patchOpenAiReasoningNoneEffort, type OpenAiResponsesPayload } from '../lib/openAiResponsesPayload.js'
import { areLocalMessageToolsEnabled } from '../lib/imessageDb.js'

const sessions = new Map<string, Agent>()

const USER_PROFILE_BEGIN = '<<<BEGIN_USER_PROFILE_FROM_ME_MD>>>'
const USER_PROFILE_END = '<<<END_USER_PROFILE_FROM_ME_MD>>>'

/**
 * Non-empty when wiki/me.md exists — full file body is injected into the main agent system prompt.
 * Exported for tests.
 */
export function meProfilePromptSection(wikiRoot: string): string {
  const path = join(wikiRoot, 'me.md')
  if (!existsSync(path)) return ''
  let body: string
  try {
    body = readFileSync(path, 'utf-8')
  } catch {
    return ''
  }
  return `\n## User profile (me.md)\nThe block below is the user's profile from **me.md** at the wiki root. It is core context for this session—use it to tailor tone, context, and priorities. Do not assume facts that are not in the wiki, tools, or this profile. **Do not** call the read tool for \`me.md\` unless the user explicitly asks you to reload it.\n\n${USER_PROFILE_BEGIN}\n${body}${body.endsWith('\n') ? '' : '\n'}${USER_PROFILE_END}\n`
}

function buildBaseSystemPrompt(includeLocalMessageCapabilities: boolean, wikiRoot: string): string {
  const meHint = meProfilePromptSection(wikiRoot)
  const localMessagesBullet = includeLocalMessageCapabilities
    ? `- On macOS (when available), read local SMS/text and iMessage history with list_recent_messages and get_message_thread (resolve phone/email from wiki, then query by chat_identifier)`
    : ''
  return `You are a personal assistant with access to a markdown wiki, email, web search, and YouTube.${meHint}

## Chat title
- On the first user message of a conversation (and when the topic clearly changes), call **set_chat_title** first with a short, specific title (about 3–8 words) that reflects what the user is asking. Do this before any other tools in that turn.
- Skip set_chat_title on trivial follow-ups that stay on the same topic.

## Your capabilities
- Search and read wiki pages using grep and find tools
- Edit existing wiki pages using the edit tool (oldText/newText replacement with fuzzy matching)
- Create new wiki pages using the write tool
- Search and read using search_index (regex \`pattern\`/\`query\` plus optional structured filters like \`from\`/\`after\`—not inline \`from:\` in the string) and read_doc; **inbox_rules** only when the user explicitly wants to change ripmail inbox filtering rules (rare)
- Search the web with web_search; fetch article text from URLs with fetch_page when needed
- Find videos with youtube_search and read captions/transcripts with get_youtube_transcript (video URL or ID)
- Open the in-app detail panel for a wiki path, email id, or calendar date using the open tool so the user can read the full artifact beside chat (optional; you can also use wiki: / date: links in markdown)
${localMessagesBullet}

## Guidelines
- Use tools to look up information before answering — don't guess.
- When editing wiki files: make the edit and show the user what changed. Wiki files are saved locally; do not ask the user to commit or push.
- Keep responses concise and helpful; use markdown.
- Paths in tools are relative to the wiki root (e.g. ideas/foo.md); never add a "wiki/" prefix.
- Wiki links for chat: [human-readable title](wiki:relative/path.md) only after confirming the file exists (find/grep/read). Put a real title or name in the brackets—# heading, frontmatter, or proper noun—not the raw path unless you're discussing the path itself. Wrong: [companies/new-relic](wiki:companies/new-relic.md). Right: [New Relic](wiki:companies/new-relic.md).
- Date links for a specific day only: [label](date:YYYY-MM-DD) with that day's exact ISO date from the current date context (e.g. [next Tuesday](date:2026-04-21)). Skip vague ranges.
- Use open with target type wiki/email/calendar when you want the UI to navigate to that artifact; prefer wiki: and date: links in prose when embedding references inline.`
}

function firstChatPromptSection(): string {
  return `

## First conversation

This is the user's first chat after onboarding. They just accepted their profile and are eager to see what Brain can do. The app may open this chat before they type — if you are speaking first, follow the goals below anyway. Your goals:

1. **Greet warmly** but briefly — introduce yourself as their personal assistant with access to their wiki, email, and the web.
2. **Reference something specific** from their profile (me.md) to show you already know them.
3. **Offer one proactive insight** — pick **one** of these (whichever seems most valuable): a recent email thread worth summarizing; a person or project from their profile you can expand on; or a wiki page that was just created they might want to review.

Keep it conversational, not overwhelming. One "wow" moment is better than a feature dump. If tools or profile content are unavailable, give a short honest intro without inventing personalization.`
}

export interface SessionOptions {
  /** Pre-injected file context for file-grounded chat */
  context?: string
  /** Override wiki directory */
  wikiDir?: string
  /** IANA timezone from the browser client (e.g. "America/Chicago") */
  timezone?: string
  /** First assistant turn after onboarding — extra prompt guidance (OPP-018). */
  firstChat?: boolean
}

/**
 * Get an existing agent session or create a new one.
 * Sessions are stored in-memory and lost on server restart.
 */
export async function getOrCreateSession(sessionId: string, options: SessionOptions = {}): Promise<Agent> {
  const existing = sessions.get(sessionId)
  if (existing) return existing

  const wikiDir = options.wikiDir ?? getWikiDir()
  const localMessagesEnabled = areLocalMessageToolsEnabled()
  const tools = createAgentTools(wikiDir)

  // Build system prompt with local date/time in the user's timezone
  const tz = options.timezone ?? 'UTC'
  const now = new Date()
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)  // YYYY-MM-DD
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(now)
  const localWeekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(now)
  // Compute the actual UTC offset for the user's timezone right now (accounts for DST)
  const gmtOffset = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(now)
    .find(p => p.type === 'timeZoneName')?.value ?? ''  // e.g. "GMT-5"
  const utcOffset = gmtOffset.replace('GMT', 'UTC')  // e.g. "UTC-5"
  let systemPrompt = `${buildBaseSystemPrompt(localMessagesEnabled, wikiDir)}\n\n## Current date & time\nToday is ${localWeekday}, ${localDate} (${localTime} ${tz}, ${utcOffset}). Use this to resolve relative dates like "tomorrow", "next week", "this weekend", etc. Calendar events are stored in UTC — to convert to local time use the ${utcOffset} offset. Do not assume a fixed offset for the timezone name; ${utcOffset} already reflects daylight saving time.`

  if (options.firstChat) {
    systemPrompt += firstChatPromptSection()
  }

  if (options.context) {
    systemPrompt += `\n\n## Current file context\nThe user is viewing the following file(s). Use this as context for the conversation.\n\n${options.context}`
  }

  // Model from env vars — supports any provider pi-ai knows about
  const provider = (process.env.LLM_PROVIDER ?? 'anthropic') as KnownProvider
  const modelId = process.env.LLM_MODEL ?? 'claude-sonnet-4-20250514'
  const model = getModel(provider, modelId as never)

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools,
    },
    onPayload: (params, m) => patchOpenAiReasoningNoneEffort(params as OpenAiResponsesPayload, m),
    getApiKey: (p: string) => {
      // pi-ai uses PROVIDER_API_KEY env convention
      const envKey = `${p.toUpperCase()}_API_KEY`
      return process.env[envKey]
    },
    convertToLlm,
  })

  sessions.set(sessionId, agent)
  return agent
}

export function deleteSession(sessionId: string): boolean {
  const agent = sessions.get(sessionId)
  if (agent) {
    agent.abort()
    sessions.delete(sessionId)
    return true
  }
  return false
}

/** Abort and drop all in-memory chat agents (e.g. dev hard-reset after deleting persisted sessions). */
export function clearAllSessions(): void {
  for (const agent of sessions.values()) {
    agent.abort()
  }
  sessions.clear()
}
