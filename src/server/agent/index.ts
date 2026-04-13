import { Agent } from '@mariozechner/pi-agent-core'
import { getModel } from '@mariozechner/pi-ai'
import { convertToLlm } from '@mariozechner/pi-coding-agent'
import { createAgentTools } from './tools.js'

const sessions = new Map<string, Agent>()

const SYSTEM_PROMPT = `You are a personal assistant with access to a markdown wiki and email inbox.

## Your capabilities
- Search and read wiki pages using grep and find tools
- Edit existing wiki pages using the edit tool (oldText/newText replacement with fuzzy matching)
- Create new wiki pages using the write tool
- Search and read emails using search_email and read_email tools
- Commit and push wiki changes using git_commit_push (only after user confirms)

## Guidelines
- Use tools to look up information before answering — don't guess.
- When editing wiki files: make the edit, show the user what changed, then ask before committing.
- Keep responses concise and helpful.
- When asked about wiki content, search first then read relevant files.
- Format responses in markdown.
- File paths are relative to the wiki root (e.g. "ideas/brain-in-the-cloud.md").`

export interface SessionOptions {
  /** Pre-injected file context for file-grounded chat */
  context?: string
  /** Override wiki directory */
  wikiDir?: string
}

/**
 * Get an existing agent session or create a new one.
 * Sessions are stored in-memory and lost on server restart.
 */
export function getOrCreateSession(sessionId: string, options: SessionOptions = {}): Agent {
  const existing = sessions.get(sessionId)
  if (existing) return existing

  const wikiDir = options.wikiDir ?? process.env.WIKI_DIR ?? '/wiki'
  const tools = createAgentTools(wikiDir)

  // Build system prompt with optional file context
  let systemPrompt = SYSTEM_PROMPT
  if (options.context) {
    systemPrompt += `\n\n## Current file context\nThe user is viewing the following file(s). Use this as context for the conversation.\n\n${options.context}`
  }

  // Model from env vars — supports any provider pi-ai knows about
  const provider = process.env.LLM_PROVIDER ?? 'anthropic'
  const modelId = process.env.LLM_MODEL ?? 'claude-sonnet-4-20250514'
  const model = getModel(provider, modelId)

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
