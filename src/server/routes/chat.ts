import { Hono } from 'hono'
import { getOrCreateSession, deleteSession } from '../agent/index.js'
import { readFile } from 'node:fs/promises'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { safeWikiRelativePath } from '@server/lib/wiki/wikiEditDiff.js'
import {
  PathEscapeError,
  resolvePathStrictlyUnderHome,
} from '@server/lib/tenant/resolveTenantSafePath.js'
import {
  appendTurn,
  deleteSessionFile,
  ensureSessionStub,
  loadSession,
  listSessions,
  patchSessionTitle,
} from '@server/lib/chat/chatStorage.js'
import { hasFirstChatPending, tryConsumeFirstChatPending } from '@server/lib/onboarding/firstChatPending.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { streamAgentSseResponse, streamStaticAssistantSse } from '@server/lib/chat/streamAgentSse.js'
import { readBackgroundRun } from '@server/lib/chat/backgroundAgentStore.js'
import {
  enqueueWikiTouchUpAfterChatTurn,
  wikiTouchUpBackgroundRunId,
} from '@server/lib/chat/wikiTouchUpJob.js'
import {
  applySkillPlaceholders,
  buildSkillPromptMessages,
  defaultChatTitleForSkill,
  parseLeadingSlashCommand,
  readSkillMarkdown,
} from '@server/lib/llm/slashSkill.js'
import { buildHearRepliesPromptMessages } from '@server/lib/llm/hearRepliesPrompt.js'
import { runWithSkillRequestContextAsync } from '@server/lib/llm/skillRequestContext.js'

/**
 * Invisible user turn for the model when the client opens first chat after onboarding (no user bubble).
 * The first-chat system supplement still applies via {@link tryConsumeFirstChatPending}.
 */
const FIRST_CHAT_KICKOFF_USER_MESSAGE = [
  'The app just opened this chat right after onboarding — the user has not typed anything yet.',
  'You speak first. Follow the "First conversation" section of your system instructions:',
  'use tools to scan their wiki, calendar, and recent mail, then open with one sharp specific observation',
  'that shows you already know their world. Do not greet generically. Do not list features.',
].join(' ')

const chat = new Hono()

// GET /api/chat/wiki-touch-up/:sessionId — latest post-chat wiki polish run for header UI
chat.get('/wiki-touch-up/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const id = wikiTouchUpBackgroundRunId(sessionId)
  const doc = await readBackgroundRun(id)
  if (!doc || doc.kind !== 'wiki-touch-up') {
    return c.json({
      status: 'idle',
      detail: null,
      anchorPaths: [] as string[],
      editedPaths: [] as string[],
    })
  }
  return c.json({
    status: doc.status,
    detail: doc.detail,
    anchorPaths: doc.wikiTouchUpAnchorPaths ?? [],
    editedPaths: doc.wikiTouchUpEditedPaths ?? [],
  })
})

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
  //   { files: string[] } — legacy file-grounded chat (wiki panel); paths must stay under wiki root
  let fileContext: string | undefined
  let validatedContextFiles: string[] | undefined
  if (typeof context === 'string') {
    fileContext = context
  } else if (context?.files?.length) {
    const wikiRoot = wikiDir()
    const safeRelPaths: string[] = []
    for (const filePath of context.files) {
      if (typeof filePath !== 'string') {
        return c.json({ error: 'context.files entries must be strings' }, 400)
      }
      const rel = safeWikiRelativePath(wikiRoot, filePath)
      if (rel == null) {
        return c.json({ error: 'Invalid wiki path in context.files' }, 400)
      }
      safeRelPaths.push(rel)
    }
    validatedContextFiles = safeRelPaths
    const parts: string[] = []
    for (const rel of safeRelPaths) {
      try {
        const segments = rel.split('/').filter((s) => s.length > 0)
        const abs = resolvePathStrictlyUnderHome(wikiRoot, ...segments)
        const content = await readFile(abs, 'utf-8')
        parts.push(`### ${rel}\n\`\`\`markdown\n${content}\n\`\`\``)
      } catch (e) {
        if (e instanceof PathEscapeError) {
          return c.json({ error: 'Invalid wiki path in context.files' }, 400)
        }
        // Skip files that can't be read (e.g. ENOENT)
      }
    }
    if (parts.length) fileContext = parts.join('\n\n')
  }

  const selectionForSkill = typeof context === 'string' ? context : ''
  const openFileForSkill = validatedContextFiles?.length ? validatedContextFiles[0] : undefined

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

    return runWithSkillRequestContextAsync(
      { selection: selectionForSkill, openFile: openFileForSkill },
      async () =>
        await streamAgentSseResponse(c, agent, rawMessage ?? message, {
          wikiDirForDiffs: wikiDir(),
          announceSessionId: sessionId,
          agentKind: 'chat_skill',
          promptMessages,
          userMessageForPersistence: firstChatKickoff ? undefined : (rawMessage as string),
          omitUserMessageFromPersistence: firstChatKickoff,
          onTurnComplete: persist,
          onSessionTitlePersist: (t) => patchSessionTitle(sessionId, t),
          initialSessionTitle,
          timezone: typeof timezone === 'string' ? timezone : undefined,
          onWikiFilesTouchedAfterTurn: ({ changedFiles, timezone: tz, workspaceHandle }) => {
            enqueueWikiTouchUpAfterChatTurn({
              sessionId,
              changedFiles,
              timezone: tz,
              workspaceHandle,
            })
          },
        }),
    )
  }

  const agent = await getOrCreateSession(sessionId, { context: fileContext, timezone, firstChat })

  const mainPromptMessages = hearReplies ? buildHearRepliesPromptMessages(message) : undefined

  return runWithSkillRequestContextAsync(
    { selection: selectionForSkill, openFile: openFileForSkill },
    async () =>
      await streamAgentSseResponse(c, agent, rawMessage ?? message, {
        wikiDirForDiffs: wikiDir(),
        announceSessionId: sessionId,
        agentKind: 'chat',
        promptMessages: mainPromptMessages,
        userMessageForPersistence: firstChatKickoff ? undefined : (rawMessage as string),
        omitUserMessageFromPersistence: firstChatKickoff,
        onTurnComplete: persist,
        onSessionTitlePersist: (t) => patchSessionTitle(sessionId, t),
        timezone: typeof timezone === 'string' ? timezone : undefined,
        onWikiFilesTouchedAfterTurn: ({ changedFiles, timezone: tz, workspaceHandle }) => {
          enqueueWikiTouchUpAfterChatTurn({
            sessionId,
            changedFiles,
            timezone: tz,
            workspaceHandle,
          })
        },
      }),
  )
})

// DELETE /api/chat/:sessionId — delete a session and its persisted file
chat.delete('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  deleteSession(sessionId)
  await deleteSessionFile(sessionId)
  return c.json({ ok: true })
})

export default chat
