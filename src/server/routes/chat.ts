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
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import {
  streamAgentSseResponse,
  streamFinishConversationShortcutSse,
  streamStaticAssistantSse,
} from '@server/lib/chat/streamAgentSse.js'
import { isBrainFinishConversationSubmit } from '@shared/finishConversationShortcut.js'
import {
  applySkillPlaceholders,
  buildSkillPromptMessages,
  defaultChatTitleForSkill,
  parseLeadingSlashCommand,
  readSkillMarkdown,
} from '@server/lib/llm/slashSkill.js'
import { buildHearRepliesPromptMessages } from '@server/lib/llm/hearRepliesPrompt.js'
import {
  enrichNotificationKickoffFromDb,
  mergeNotificationKickoffPromptMessages,
  parseNotificationKickoffFromBody,
} from '@server/lib/llm/notificationKickoffPrompt.js'
import { runWithSkillRequestContextAsync } from '@server/lib/llm/skillRequestContext.js'
import { readOnboardingStateDoc } from '@server/lib/onboarding/onboardingState.js'
import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'
import { buildMailCoverageCaveatForMainAssistant } from '@server/lib/onboarding/mailCoverageCaveatPrompt.js'
import {
  buildInitialBootstrapKickoffUserMessage,
  formatMailIndexFactsForBootstrap,
  getOrCreateInitialBootstrapSession,
} from '../agent/initialBootstrapAgent.js'

const chat = new Hono()

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
// Body: { message, sessionId?, context?, initialBootstrapKickoff?, hearReplies? }
// Response: SSE stream of agent events
chat.post('/', async (c) => {
  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const initialBootstrapKickoff = body.initialBootstrapKickoff === true
  const hearReplies = body.hearReplies === true
  const rawSessionId = body.sessionId
  const sessionId =
    typeof rawSessionId === 'string' && rawSessionId.trim().length > 0
      ? rawSessionId.trim()
      : crypto.randomUUID()
  const rawContext = body.context
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  const rawMessage = body.message

  let onboardingState = 'not-started'
  try {
    const doc = await readOnboardingStateDoc()
    onboardingState = doc.state
  } catch {
    /* ignore */
  }
  const bootstrapMode = onboardingState === 'onboarding-agent'

  if (!initialBootstrapKickoff && (!rawMessage || typeof rawMessage !== 'string')) {
    return c.json({ error: 'message is required' }, 400)
  }
  if (initialBootstrapKickoff && rawMessage != null && typeof rawMessage !== 'string') {
    return c.json({ error: 'message must be a string when provided' }, 400)
  }

  try {
    await ensureSessionStub(sessionId)
  } catch {
    /* best-effort — stream still runs */
  }

  if (initialBootstrapKickoff) {
    if (!bootstrapMode) {
      return c.json({ error: 'initial bootstrap kickoff is not available' }, 400)
    }
    try {
      const sessionDoc = await loadSession(sessionId)
      if (sessionDoc && sessionDoc.messages.length > 0) {
        return c.json({ error: 'initial bootstrap kickoff requires an empty session' }, 400)
      }
    } catch {
      /* ignore */
    }
  }

  const promptMessage = initialBootstrapKickoff
    ? await buildInitialBootstrapKickoffUserMessage()
    : (rawMessage as string)

  let notificationKickoff =
    !bootstrapMode && !initialBootstrapKickoff
      ? parseNotificationKickoffFromBody(body)
      : null
  if (notificationKickoff) {
    try {
      const doc = await loadSession(sessionId)
      if (doc && doc.messages.length > 0) notificationKickoff = null
    } catch {
      /* ignore */
    }
  }
  if (notificationKickoff) {
    notificationKickoff = enrichNotificationKickoffFromDb(notificationKickoff)
  }

  let mailCoverageCaveat: string | undefined
  if (!bootstrapMode) {
    try {
      mailCoverageCaveat =
        buildMailCoverageCaveatForMainAssistant(await getOnboardingMailStatus()) ?? undefined
    } catch {
      /* ignore — main chat still works without caveat */
    }
  }

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

  if (
    !initialBootstrapKickoff &&
    typeof rawMessage === 'string' &&
    isBrainFinishConversationSubmit(rawMessage.trim())
  ) {
    const display =
      typeof body.userMessageDisplay === 'string' ? body.userMessageDisplay.trim() : ''
    const userMessageForPersistence = display || rawMessage.trim()
    return streamFinishConversationShortcutSse(c, {
      announceSessionId: sessionId,
      userMessageForPersistence,
      onTurnComplete: persist,
    })
  }

  // Build context string for the session system prompt.
  // Two formats:
  //   string  — surface context (email body, wiki path, etc.) from AgentChat
  //   { files: string[] } — legacy file-grounded chat (wiki panel); paths must stay under wiki root
  let fileContext: string | undefined
  let validatedContextFiles: string[] | undefined
  if (typeof rawContext === 'string') {
    fileContext = rawContext
  } else if (
    rawContext &&
    typeof rawContext === 'object' &&
    !Array.isArray(rawContext) &&
    Array.isArray((rawContext as { files?: unknown }).files) &&
    (rawContext as { files: unknown[] }).files.length > 0
  ) {
    const wikiRoot = wikiDir()
    const safeRelPaths: string[] = []
    for (const filePath of (rawContext as { files: unknown[] }).files) {
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

  const selectionForSkill = typeof rawContext === 'string' ? rawContext : ''
  const openFileForSkill = validatedContextFiles?.length ? validatedContextFiles[0] : undefined

  const slash = parseLeadingSlashCommand(promptMessage)
  if (slash && bootstrapMode) {
    return streamStaticAssistantSse(c, {
      announceSessionId: sessionId,
      userMessageForPersistence: promptMessage,
      text: 'Finish setup in chat first. Slash skills are available after setup completes.',
      onTurnComplete: persist,
    })
  }

  if (slash) {
    const skillDoc = await readSkillMarkdown(slash.slug)
    if (!skillDoc) {
      return streamStaticAssistantSse(c, {
        announceSessionId: sessionId,
        userMessageForPersistence: promptMessage,
        text: `Unknown skill \`/${slash.slug}\`. Use **GET /api/skills** to list skills, or add \`$BRAIN_HOME/skills/${slash.slug}/SKILL.md\` to override a bundled skill.`,
        onTurnComplete: persist,
      })
    }

    const skillBody = applySkillPlaceholders(skillDoc.body, {
      selection: selectionForSkill,
      openFile: openFileForSkill,
    })
    const skillMessages = buildSkillPromptMessages(slash.slug, skillBody, slash.args)
    const hearMsgs = hearReplies ? buildHearRepliesPromptMessages(promptMessage) : undefined
    const skillPromptMessages = notificationKickoff
      ? [...mergeNotificationKickoffPromptMessages(promptMessage, notificationKickoff, hearMsgs), ...skillMessages]
      : hearMsgs
        ? [...hearMsgs, ...skillMessages]
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

    const agent = await getOrCreateSession(sessionId, {
      context: fileContext,
      timezone,
      mailCoverageCaveat,
    })

    return runWithSkillRequestContextAsync(
      { selection: selectionForSkill, openFile: openFileForSkill },
      async () =>
        await streamAgentSseResponse(c, agent, (typeof rawMessage === 'string' ? rawMessage : promptMessage), {
          wikiDirForDiffs: wikiDir(),
          announceSessionId: sessionId,
          agentKind: 'chat_skill',
          promptMessages: skillPromptMessages,
          userMessageForPersistence: typeof rawMessage === 'string' ? rawMessage : promptMessage,
          onTurnComplete: persist,
          onSessionTitlePersist: (t) => patchSessionTitle(sessionId, t),
          initialSessionTitle,
          timezone,
        }),
    )
  }

  if (bootstrapMode) {
    const mail = await getOnboardingMailStatus()
    const mailFacts = formatMailIndexFactsForBootstrap(mail)
    const agent = await getOrCreateInitialBootstrapSession(sessionId, {
      timezone,
      mailFactsBlock: mailFacts,
    })
    const mainPromptMessages = hearReplies
      ? buildHearRepliesPromptMessages(promptMessage)
      : undefined

    return runWithSkillRequestContextAsync(
      { selection: selectionForSkill, openFile: openFileForSkill },
      async () =>
        await streamAgentSseResponse(c, agent, promptMessage, {
          wikiDirForDiffs: wikiDir(),
          announceSessionId: sessionId,
          agentKind: 'onboarding_interview',
          promptMessages: mainPromptMessages,
          userMessageForPersistence: initialBootstrapKickoff ? undefined : (rawMessage as string),
          omitUserMessageFromPersistence: initialBootstrapKickoff,
          onTurnComplete: persist,
          onSessionTitlePersist: (t) => patchSessionTitle(sessionId, t),
          timezone,
        }),
    )
  }

  const agent = await getOrCreateSession(sessionId, {
    context: fileContext,
    timezone,
    mailCoverageCaveat,
  })

  const hearMain = hearReplies ? buildHearRepliesPromptMessages(promptMessage) : undefined
  const mainPromptMessages = notificationKickoff
    ? mergeNotificationKickoffPromptMessages(promptMessage, notificationKickoff, hearMain)
    : hearMain

  return runWithSkillRequestContextAsync(
    { selection: selectionForSkill, openFile: openFileForSkill },
    async () =>
      await streamAgentSseResponse(c, agent, promptMessage, {
        wikiDirForDiffs: wikiDir(),
        announceSessionId: sessionId,
        agentKind: 'chat',
        promptMessages: mainPromptMessages,
        userMessageForPersistence: typeof rawMessage === 'string' ? rawMessage : promptMessage,
        onTurnComplete: persist,
        onSessionTitlePersist: (t) => patchSessionTitle(sessionId, t),
        timezone,
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
