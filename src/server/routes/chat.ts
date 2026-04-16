import { Hono } from 'hono'
import { getOrCreateSession, deleteSession } from '../agent/index.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '../lib/wikiDir.js'
import { appendTurn, deleteSessionFile, loadSession, listSessions } from '../lib/chatStorage.js'
import { streamAgentSseResponse, streamStaticAssistantSse } from '../lib/streamAgentSse.js'
import {
  applySkillPlaceholders,
  buildSkillPromptMessages,
  parseLeadingSlashCommand,
  readSkillMarkdown,
} from '../lib/slashSkill.js'

const chat = new Hono()

// GET /api/chat/sessions — list persisted sessions (register before /:sessionId)
chat.get('/sessions', async (c) => {
  const sessions = await listSessions()
  return c.json(sessions)
})

// GET /api/chat/sessions/:sessionId — full session document
chat.get('/sessions/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const doc = await loadSession(sessionId)
  if (!doc) return c.json({ error: 'Not found' }, 404)
  return c.json(doc)
})

// POST /api/chat
// Body: { message: string, sessionId?: string, context?: { files?: string[] } }
// Response: SSE stream of agent events
chat.post('/', async (c) => {
  const body = await c.req.json()
  const { message, sessionId = crypto.randomUUID(), context, timezone } = body

  if (!message || typeof message !== 'string') {
    return c.json({ error: 'message is required' }, 400)
  }

  // Build context string for the session system prompt.
  // Two formats:
  //   string  — surface context (email body, wiki path, etc.) from AgentChat
  //   { files: string[] } — legacy file-grounded chat (wiki panel)
  let fileContext: string | undefined
  if (typeof context === 'string') {
    fileContext = context
  } else if (context?.files?.length) {
    const parts: string[] = []
    for (const filePath of context.files) {
      try {
        const content = await readFile(join(wikiDir(), filePath), 'utf-8')
        parts.push(`### ${filePath}\n\`\`\`markdown\n${content}\n\`\`\``)
      } catch {
        // Skip files that can't be read
      }
    }
    if (parts.length) fileContext = parts.join('\n\n')
  }

  const selectionForSkill = typeof context === 'string' ? context : ''
  const openFileForSkill =
    context && typeof context === 'object' && Array.isArray(context.files) && context.files.length
      ? String(context.files[0])
      : undefined

  const onTurnComplete = async ({
    userMessage,
    assistantMessage,
    turnTitle,
  }: {
    userMessage: string
    assistantMessage: Parameters<typeof appendTurn>[0] extends { sessionId: string } ? never : never
  }) => {
    try {
      await appendTurn({
        sessionId,
        userMessage,
        assistantMessage,
        title: turnTitle,
      })
    } catch {
      // Best-effort persistence; do not fail the stream
    }
  }

  const persist = async (args: {
    userMessage: string
    assistantMessage: import('../lib/chatTypes.js').ChatMessage
    turnTitle: string | null | undefined
  }) => {
    try {
      await appendTurn({
        sessionId,
        userMessage: args.userMessage,
        assistantMessage: args.assistantMessage,
        title: args.turnTitle,
      })
    } catch {
      /* best-effort */
    }
  }

  const slash = parseLeadingSlashCommand(message)
  if (slash) {
    const skillDoc = await readSkillMarkdown(slash.slug)
    if (!skillDoc) {
      return streamStaticAssistantSse(c, {
        announceSessionId: sessionId,
        userMessageForPersistence: message,
        text: `Unknown skill \`/${slash.slug}\`. Use **GET /api/skills** to list skills, or add \`skills/${slash.slug}/SKILL.md\` under your wiki directory.`,
        onTurnComplete: persist,
      })
    }

    const skillBody = applySkillPlaceholders(skillDoc.body, {
      selection: selectionForSkill,
      openFile: openFileForSkill,
    })
    const promptMessages = buildSkillPromptMessages(slash.slug, skillBody, slash.args)

    const agent = await getOrCreateSession(sessionId, { context: fileContext, timezone })

    return streamAgentSseResponse(c, agent, message, {
      wikiDirForDiffs: wikiDir(),
      announceSessionId: sessionId,
      promptMessages,
      userMessageForPersistence: message,
      onTurnComplete: persist,
    })
  }

  const agent = await getOrCreateSession(sessionId, { context: fileContext, timezone })

  return streamAgentSseResponse(c, agent, message, {
    wikiDirForDiffs: wikiDir(),
    announceSessionId: sessionId,
    onTurnComplete: persist,
  })
})

// DELETE /api/chat/:sessionId — delete a session and its persisted file
chat.delete('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  deleteSession(sessionId)
  await deleteSessionFile(sessionId)
  return c.json({ ok: true })
})

export default chat
