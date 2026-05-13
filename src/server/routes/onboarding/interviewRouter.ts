import { Hono } from 'hono'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { appendTurn, ensureSessionStub } from '@server/lib/chat/chatStorage.js'
import type { ChatMessage } from '@server/lib/chat/chatTypes.js'
import { streamAgentSseResponse, streamFinishConversationShortcutSse } from '@server/lib/chat/streamAgentSse.js'
import { isBrainFinishConversationSubmit } from '@shared/finishConversationShortcut.js'
import {
  buildInterviewKickoffUserMessage,
  clearAllInterviewSessions,
  deleteInterviewSession,
  getOrCreateOnboardingInterviewAgent,
} from '@server/agent/onboardingInterviewAgent.js'
import { fetchRipmailWhoamiForProfiling } from '@server/agent/profilingAgent.js'
import { runInterviewFinalize } from '@server/agent/interviewFinalizeAgent.js'
import { deleteWikiBuildoutSession, ensureWikiVaultScaffoldForBuildout } from '@server/agent/wikiBuildoutAgent.js'
import {
  readOnboardingStateDoc,
  setOnboardingState,
  writeOnboardingStateDoc,
} from '@server/lib/onboarding/onboardingState.js'
import { notifyOnboardingInterviewDone } from '@server/lib/backgroundTasks/orchestrator.js'
import { deleteBootstrapSession } from '@server/agent/initialBootstrapAgent.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export const onboardingInterviewRouter = new Hono()

/**
 * OPP-054 guided onboarding interview (streams SSE; persists turns for finalize).
 */
onboardingInterviewRouter.post('/interview', async (c) => {
  const body = await c.req.json()
  const interviewKickoff = body.interviewKickoff === true
  const message = typeof body.message === 'string' ? body.message : ''
  if (!message.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : crypto.randomUUID()
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined

  try {
    await ensureSessionStub(sessionId)
  } catch {
    /* best-effort */
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

  if (!interviewKickoff && isBrainFinishConversationSubmit(message.trim())) {
    const display =
      typeof body.userMessageDisplay === 'string' ? body.userMessageDisplay.trim() : ''
    const userMessageForPersistence = display || message.trim()
    return streamFinishConversationShortcutSse(c, {
      announceSessionId: sessionId,
      userMessageForPersistence,
      onTurnComplete: persist,
    })
  }

  const agent = await getOrCreateOnboardingInterviewAgent(sessionId, { timezone })
  let promptMessage = message.trim()
  const omitUserRow = interviewKickoff
  if (interviewKickoff) {
    const whoami = await fetchRipmailWhoamiForProfiling()
    promptMessage = buildInterviewKickoffUserMessage(whoami, message.trim())
  }

  return streamAgentSseResponse(c, agent, promptMessage, {
    wikiDirForDiffs: wikiDir(),
    announceSessionId: sessionId,
    agentKind: 'onboarding_interview',
    onTurnComplete: persist,
    timezone,
    omitUserMessageFromPersistence: omitUserRow,
  })
})

onboardingInterviewRouter.post('/finalize', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400)
  }
  const doc = await readOnboardingStateDoc()
  const pendingInitialBootstrapFinalize = doc.initialBootstrapSessionId === sessionId
  if (doc.state === 'done' && !pendingInitialBootstrapFinalize) {
    return c.json({ ok: true as const, state: 'done' })
  }
  if (doc.initialBootstrapSessionId && !pendingInitialBootstrapFinalize) {
    return c.json({ error: 'Onboarding interview is not active.' }, 400)
  }
  if (doc.state !== 'onboarding-agent' && !pendingInitialBootstrapFinalize) {
    return c.json({ error: 'Onboarding interview is not active.' }, 400)
  }
  const timezone = typeof body.timezone === 'string' ? body.timezone : undefined
  try {
    await runInterviewFinalize({ sessionId, timezone })
    await ensureWikiVaultScaffoldForBuildout(wikiDir())
    const finalizedDoc = doc.state === 'done' ? doc : await setOnboardingState('done')
    const clearedDoc = { ...finalizedDoc }
    delete clearedDoc.initialBootstrapSessionId
    await writeOnboardingStateDoc(clearedDoc)
    deleteBootstrapSession(sessionId)
    void notifyOnboardingInterviewDone()
    return c.json({ ok: true as const, state: 'done' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    brainLogger.error({ err: e }, `[onboarding/finalize] ${msg}`)
    return c.json({ error: msg }, 500)
  }
})

onboardingInterviewRouter.delete('/interview-sessions', async (c) => {
  clearAllInterviewSessions()
  return c.json({ ok: true as const })
})

onboardingInterviewRouter.delete('/session/:kind/:sessionId', async (c) => {
  const kind = c.req.param('kind')
  const sessionId = c.req.param('sessionId')
  if (kind === 'interview') {
    deleteInterviewSession(sessionId)
    return c.json({ ok: true })
  }
  if (kind === 'buildout') {
    deleteWikiBuildoutSession(sessionId)
    return c.json({ ok: true })
  }
  return c.json({ error: 'kind must be interview or buildout' }, 400)
})
