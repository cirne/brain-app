import { Agent } from '@mariozechner/pi-agent-core'
import { getModel, type KnownProvider } from '@mariozechner/pi-ai'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import { createAgentTools } from './tools.js'
import { wikiDir as getWikiDir } from '../lib/wikiDir.js'
import { listWikiFiles } from '../lib/wikiFiles.js'

const sessions = new Map<string, Agent>()

const SYSTEM_PROMPT = `You are a personal assistant with access to a markdown wiki and email inbox.

## Your capabilities
- Search and read wiki pages using grep and find tools
- Edit existing wiki pages using the edit tool (oldText/newText replacement with fuzzy matching)
- Create new wiki pages using the write tool
- Search and read emails using search_email and read_email tools
- Search the web using web_search for current information not in the wiki or email
- Commit and push wiki changes using git_commit_push (only after user confirms)

## Guidelines
- Use tools to look up information before answering — don't guess.
- When editing wiki files: make the edit, show the user what changed, then ask before committing.
- After any session where you create or significantly update wiki pages, call wiki_log with a one-line summary. Do not call it for read-only queries or email searches that didn't produce wiki edits.
- Keep responses concise and helpful.
- When asked about wiki content, search first then read relevant files.
- Format responses in markdown.
- File paths are relative to the wiki root (e.g. "ideas/brain-in-the-cloud.md"). Do NOT include a "wiki/" prefix — the tools are already scoped to the wiki directory.
- When mentioning specific calendar dates, format them as markdown date links: [display text](date:YYYY-MM-DD). Use the exact ISO date based on the current date context. Examples: [Friday, April 17](date:2026-04-17), [next Tuesday](date:2026-04-21), [today](date:2026-04-13). This lets the user click dates to see calendar events. Only link dates that refer to specific days, not vague time references.
- When mentioning people, projects, places, or other nouns that have a wiki page, format them as wiki links: [display text](wiki:path/to/file.md). Only link terms where the exact page path appears in the ## Wiki pages section below. This lets the user click to navigate directly to that page.`

export interface SessionOptions {
  /** Pre-injected file context for file-grounded chat */
  context?: string
  /** Override wiki directory */
  wikiDir?: string
  /** IANA timezone from the browser client (e.g. "America/Chicago") */
  timezone?: string
}

/**
 * Get an existing agent session or create a new one.
 * Sessions are stored in-memory and lost on server restart.
 */
export async function getOrCreateSession(sessionId: string, options: SessionOptions = {}): Promise<Agent> {
  const existing = sessions.get(sessionId)
  if (existing) return existing

  const wikiDir = options.wikiDir ?? getWikiDir()
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
  let systemPrompt = `${SYSTEM_PROMPT}\n\n## Current date & time\nToday is ${localWeekday}, ${localDate} (${localTime} ${tz}, ${utcOffset}). Use this to resolve relative dates like "tomorrow", "next week", "this weekend", etc. Calendar events are stored in UTC — to convert to local time use the ${utcOffset} offset. Do not assume a fixed offset for the timezone name; ${utcOffset} already reflects daylight saving time.`

  // Include wiki file list so the LLM can auto-link references to wiki pages
  try {
    const wikiFiles = await listWikiFiles(wikiDir)
    if (wikiFiles.length > 0) {
      systemPrompt += `\n\n## Wiki pages\n${wikiFiles.join('\n')}`
    }
  } catch {
    // Non-fatal: wiki dir may not exist yet
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
