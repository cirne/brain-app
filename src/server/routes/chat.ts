import { Hono } from 'hono'
import { getOrCreateSession, deleteSession } from '../agent/index.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { wikiDir } from '../lib/wikiDir.js'
import {
  appendTurn,
  deleteSessionFile,
  ensureSessionStub,
  loadSession,
  listSessions,
  patchSessionTitle,
} from '../lib/chatStorage.js'
import { hasFirstChatPending, tryConsumeFirstChatPending } from '../lib/firstChatPending.js'
import type { ChatMessage } from '../lib/chatTypes.js'
import { streamAgentSseResponse, streamStaticAssistantSse } from '../lib/streamAgentSse.js'
import {
  applySkillPlaceholders,
  buildSkillPromptMessages,
  defaultChatTitleForSkill,
  parseLeadingSlashCommand,
  readSkillMarkdown,
} from '../lib/slashSkill.js'
import { buildHearRepliesPromptMessages } from '../lib/hearRepliesPrompt.js'

/**
 * Invisible user turn for the model when the client opens first chat after onboarding (no user bubble).
 * The first-chat system supplement still applies via {@link tryConsumeFirstChatPending}.
 */
const FIRST_CHAT_KICKOFF_USER_MESSAGE = [
  'The app just opened this chat right after onboarding — the user has not typed anything yet.',
  'You speak first. Follow the "First conversation" section of your system instructions: greet briefly,',
  'reference something specific from their profile (me.md) when available, and offer one proactive insight.',
].join(' ')

const chat = new Hono()

// GET /api/chat/first-chat-pending — whether accept-profile wrote the marker (no consume)
chat.get('/first-chat-pending', async (c) => {
  return c.json({ pending: await hasFirstChatPending() })
})

/** Ignore absurd limits from clients; sidebar uses a small fixed cap. */
const CHAT_SESSIONS_LIST_MAX_QUERY = 500

// GET /api/chat/sessions — list persisted sessions (register before /:sessionId)
// Optional query: `limit` — positive integer, max {@link CHAT_SESSIONS_LIST_MAX_QUERY}; omit for full list.
chat.get('/sessions', async (c) => {
  const raw = c.req.query('limit')
  let limit: number | undefined
  if (raw != null && raw !== '') {
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0) {
      limit = Math.min(n, CHAT_SESSIONS_LIST_MAX_QUERY)
    }
  }
  const sessions = await listSessions(limit)
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
// Body: { message, sessionId?, context?, firstChatKickoff?, hearReplies? }
// Response: SSE stream of agent events
chat.post('/', async (c) => {
  const body = await c.req.json()
  const firstChatKickoff = body.firstChatKickoff === true
  const hearReplies = body.hearReplies === true
  const { sessionId = crypto.randomUUID(), context, timezone } = body
  const rawMessage = body.message

  if (!firstChatKickoff && (!rawMessage || typeof rawMessage !== 'string')) {
    return c.json({ error: 'message is required' }, 400)
  }
  if (firstChatKickoff && rawMessage != null && typeof rawMessage !== 'string') {
    return c.json({ error: 'message must be a string when provided' }, 400)
  }

  const message = firstChatKickoff ? FIRST_CHAT_KICKOFF_USER_MESSAGE : (rawMessage as string)

  try {
    await ensureSessionStub(sessionId)
  } catch {
    /* best-effort — stream still runs */
  }

  let firstChat = false
  try {
    const sessionDoc = await loadSession(sessionId)
    if (sessionDoc && sessionDoc.messages.length === 0) {
      firstChat = await tryConsumeFirstChatPending()
    }
  } catch {
    /* ignore */
  }

  if (firstChatKickoff && !firstChat) {
    return c.json({ error: 'first chat kickoff is not available' }, 400)
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

  const persist = async (args: {
    userMessage: string | null
    assistantMessage: ChatMessage
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
        text: `Unknown skill \`/${slash.slug}\`. Use **GET /api/skills** to list skills, or add \`$BRAIN_HOME/skills/${slash.slug}/SKILL.md\` to override a bundled skill.`,
        onTurnComplete: persist,
      })
    }

    const skillBody = applySkillPlaceholders(skillDoc.body, {
      selection: selectionForSkill,
      openFile: openFileForSkill,
    })
    const skillMessages = buildSkillPromptMessages(slash.slug, skillBody, slash.args)
    const promptMessages = hearReplies
      ? [...buildHearRepliesPromptMessages(message), ...skillMessages]
      : skillMessages

    let initialSessionTitle: string | undefined
    try {
      const doc = await loadSession(sessionId)
      if (!doc?.title?.trim()) {
        initialSessionTitle = defaultChatTitleForSkill({
          slug: slash.slug,
          name: skillDoc.name,
          label: skillDoc.label,
          args: slash.args,
        })
      }
    } catch {
      /* ignore */
    }

    const agent = await getOrCreateSession(sessionId, { context: fileContext, timezone, firstChat })

    return streamAgentSseResponse(c, agent, rawMessage ?? message, {
      wikiDirForDiffs: wikiDir(),
      announceSessionId: sessionId,
      agentKind: 'chat_skill',
      promptMessages,
      userMessageForPersistence: firstChatKickoff ? undefined : (rawMessage as string),
      omitUserMessageFromPersistence: firstChatKickoff,
      onTurnComplete: persist,
      onSessionTitlePersist: (t) => patchSessionTitle(sessionId, t),
      initialSessionTitle,
    })
  }

  const agent = await getOrCreateSession(sessionId, { context: fileContext, timezone, firstChat })

  const mainPromptMessages = hearReplies ? buildHearRepliesPromptMessages(message) : undefined

  return streamAgentSseResponse(c, agent, rawMessage ?? message, {
    wikiDirForDiffs: wikiDir(),
    announceSessionId: sessionId,
    agentKind: 'chat',
    promptMessages: mainPromptMessages,
    userMessageForPersistence: firstChatKickoff ? undefined : (rawMessage as string),
    omitUserMessageFromPersistence: firstChatKickoff,
    onTurnComplete: persist,
    onSessionTitlePersist: (t) => patchSessionTitle(sessionId, t),
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
