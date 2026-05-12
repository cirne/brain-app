import { expect, test } from '@playwright/test'
import {
  addBrainSessionCookieToContext,
  applyEnronCollaborationE2eGate,
  attachAssistantChatPageDiagnostics,
  createStepLogger,
  dismissUnreadNotificationsViaApi,
  ENRON_B2B_AGENT_TIMEOUTS,
  ENRON_DEMO_HANDLE_KEAN,
  ENRON_DEMO_HANDLE_LAY,
  ensureEmptyChatComposerContext,
  formatAssistantReplyDiagnostics,
  getEnronDemoSecret,
  gotoBrainAccessViaChatWarmup,
  inviteTrustedCollaboratorViaSearch,
  mintFreshEnronDemoCookieForBrowser,
  prepareEnronDemoSessionNoSoftReset,
  provisionEnronDemoPeerForCollaboratorDirectory,
  revokeBrainQueryGrantsForAskerHandleViaApi,
  waitForAssistantReply,
  waitForChatPostRequestIncluding,
  waitUntilWorkspaceHandlesApiIncludes,
} from './helpers'

/** Shared `./data` Enron personas — avoids `soft-reset`; use `playwright --workers=1` if specs race the same tenants. */

test.describe('B2B sharing (Settings → collaborator → Ask Brain)', () => {
  test.beforeEach(async ({ request, baseURL }) => {
    await applyEnronCollaborationE2eGate(test.skip, request, baseURL!)
  })

  test('three-phase demo: Steve invites Lay, Lay uses Ask Brain (ask_collaborator), Steve drafts reply email', async ({
    browser,
    request,
    baseURL,
  }) => {
    const { uiTimeoutMs, chatPostTimeoutMs, assistantAnswerTimeoutMs } = ENRON_B2B_AGENT_TIMEOUTS
    test.setTimeout(ENRON_B2B_AGENT_TIMEOUTS.testTimeoutMs)
    const { logStep } = createStepLogger('b2b-sharing')
    const secret = getEnronDemoSecret()!
    const base = baseURL!

    // Clear stale unanswered notifications on Steve’s tenant so Phase 3 shows Ken’s ping.
    logStep('prepare Steve tenant (API; no soft reset)')
    let { sessionCookie: steveCookie } = await prepareEnronDemoSessionNoSoftReset(request, base, secret, {
      timeoutMs: uiTimeoutMs,
      demoUser: 'kean',
    })
    await dismissUnreadNotificationsViaApi(request, base, steveCookie)

    logStep('ensure Ken Lay tenant exists in workspace directory (API; no browser yet)')
    await provisionEnronDemoPeerForCollaboratorDirectory(request, base, secret, {
      timeoutMs: uiTimeoutMs,
      demoUser: 'lay',
    })
    await waitUntilWorkspaceHandlesApiIncludes(request, base, steveCookie, ENRON_DEMO_HANDLE_LAY, {
      timeoutMs: uiTimeoutMs * 4,
      pollMs: 500,
      directoryQuery: 'ken',
    })

    /** Final Bearer mint immediately before attaching brain_session — same rhythm as `prepareEnronAssistantChatSession`. */
    logStep('remint Steve (kean) session cookie for Phase 1 browser')
    steveCookie = (
      await mintFreshEnronDemoCookieForBrowser(request, base, secret, { demoUser: 'kean' })
    ).cookie

    logStep('API: revoke any existing Lay grants (UI bubble can stay disabled/removeBusy during reload)')
    await revokeBrainQueryGrantsForAskerHandleViaApi(request, base, steveCookie, ENRON_DEMO_HANDLE_LAY)

    // --- PHASE 1: Steve invites Ken as Trusted Confidante ---
    logStep('open browser as Steve Kean')
    const steveErrors: string[] = []
    const steveCtx = await browser.newContext()
    await addBrainSessionCookieToContext(steveCtx, base, steveCookie)
    const stevePage = await steveCtx.newPage()
    attachAssistantChatPageDiagnostics(stevePage, { logTag: 'b2b-steve', runtimeErrors: steveErrors })

    logStep('bootstrap shell: load /c then /settings/brain-access')
    await gotoBrainAccessViaChatWarmup(stevePage, base, { uiTimeoutMs })

    await inviteTrustedCollaboratorViaSearch(stevePage, {
      collaboratorHandle: ENRON_DEMO_HANDLE_LAY,
      searchQuery: 'ken',
      uiTimeoutMs,
    })
    logStep('Lay added under Trusted Confidante')

    await steveCtx.close()

    logStep('remint Ken (lay) session cookie for Phase 2 browser')
    const kenCookie = (
      await mintFreshEnronDemoCookieForBrowser(request, base, secret, { demoUser: 'lay' })
    ).cookie

    // --- PHASE 2: Lay sees grant ping, asks Ask Brain (wire `ask_collaborator`; UI label Ask Brain) ---
    logStep('open browser as Ken Lay')
    const kenErrors: string[] = []
    const kenCtx = await browser.newContext()
    await addBrainSessionCookieToContext(kenCtx, base, kenCookie)
    const kenPage = await kenCtx.newPage()
    attachAssistantChatPageDiagnostics(kenPage, { logTag: 'b2b-ken', runtimeErrors: kenErrors })

    await kenPage.goto(`${base}/c`, { waitUntil: 'domcontentloaded' })
    const kenComposer = kenPage.locator('.chat-textarea')
    await expect(kenComposer).toBeVisible({ timeout: uiTimeoutMs })

    await ensureEmptyChatComposerContext(kenPage, { uiTimeoutMs })

    await expect(kenPage.getByTestId('empty-chat-notifications-strip')).toBeVisible({ timeout: uiTimeoutMs })
    const sharingLine = kenPage.locator('[data-testid="empty-chat-notif-act"]').filter({
      hasText: new RegExp(`@${ENRON_DEMO_HANDLE_KEAN}\\b.*sharing`, 'i'),
    })
    await expect(sharingLine.first()).toBeVisible({ timeout: uiTimeoutMs })
    logStep('Lay sees Brain sharing notification from Steve')

    await sharingLine.first().click()
    await waitForAssistantReply(kenPage, { timeoutMs: assistantAnswerTimeoutMs })

    await expect(kenComposer).toBeVisible()
    await ensureEmptyChatComposerContext(kenPage, { uiTimeoutMs })

    const askPrompt = `Ask @${ENRON_DEMO_HANDLE_KEAN} for an update on Dynegy.`
    logStep('Lay sends Ask Brain collaborator prompt')
    const chatPostKen = waitForChatPostRequestIncluding(kenPage, askPrompt, { timeout: chatPostTimeoutMs })
    await kenComposer.fill(askPrompt)
    await kenComposer.press('Enter')
    const kenChatRes = await chatPostKen
    expect(kenChatRes.ok()).toBeTruthy()

    /** UI label **Ask Brain** — wire tool name `ask_collaborator`. */
    const kenReply = await waitForAssistantReply(kenPage, { timeoutMs: assistantAnswerTimeoutMs })
    logStep('Lay assistant reply', { tools: kenReply.tools.map((t) => t.name) })
    expect(kenReply.tools.some((t) => t.name === 'ask_collaborator' && !t.error)).toBe(true)
    await expect(
      kenPage.locator('.message.assistant').last().locator('.tool-part[data-tool-name="ask_collaborator"]'),
    ).toBeVisible()

    await kenCtx.close()
    expect(kenErrors).toEqual([])

    // --- PHASE 3: Steve sees collaborator question notification → drafts email ---
    logStep('remint Steve (kean) session cookie for Phase 3 browser')
    steveCookie = (
      await mintFreshEnronDemoCookieForBrowser(request, base, secret, { demoUser: 'kean' })
    ).cookie

    logStep('open browser as Steve for collaborator question')
    const stevePhase3Ctx = await browser.newContext()
    await addBrainSessionCookieToContext(stevePhase3Ctx, base, steveCookie)
    const steveP3 = await stevePhase3Ctx.newPage()
    attachAssistantChatPageDiagnostics(steveP3, {
      logTag: 'b2b-steve-p3',
      runtimeErrors: steveErrors,
    })

    await steveP3.goto(`${base}/c`, { waitUntil: 'domcontentloaded' })
    await expect(steveP3.locator('.chat-textarea')).toBeVisible({ timeout: uiTimeoutMs })
    await ensureEmptyChatComposerContext(steveP3, { uiTimeoutMs })
    await expect(steveP3.getByTestId('empty-chat-notifications-strip')).toBeVisible({ timeout: uiTimeoutMs })
    const questionRow = steveP3.locator('[data-testid="empty-chat-notif-act"]').filter({
      hasText: new RegExp(`@${ENRON_DEMO_HANDLE_LAY}\\b.*asked`, 'i'),
    })
    await expect(questionRow.first()).toBeVisible({ timeout: assistantAnswerTimeoutMs })
    logStep('Steve sees collaborator question strip')

    await questionRow.first().click()
    const steveReply = await waitForAssistantReply(steveP3, { timeoutMs: assistantAnswerTimeoutMs })
    logStep('Steve assistant after notification', { tools: steveReply.tools.map((t) => t.name) })

    const steveDraftOk = steveReply.tools.some((t) => t.name === 'draft_email' && !t.error)
    const emailEditorVisible = await steveP3.getByTestId('email-draft-editor').isVisible().catch(() => false)
    const stopVisible = await steveP3.locator('.stop-btn').isVisible().catch(() => false)
    const assistantBubbleCount = await steveP3.locator('.message.assistant').count()
    const chatPostCount = await steveP3
      .evaluate(
        () => performance.getEntriesByType('resource').filter((r) => (r as PerformanceResourceTiming).name.includes('/api/chat')).length,
      )
      .catch(() => null)

    if (!steveDraftOk) {
      const diag = {
        ...formatAssistantReplyDiagnostics(steveReply),
        emailDraftEditorVisible: emailEditorVisible,
        assistantMessageCount: assistantBubbleCount,
        waitForAssistantReplyTargetsLastBubbleOnly: true,
        stopComposerVisibleAfterReply: stopVisible,
        approximateChatNetworkEntries: chatPostCount,
        note:
          'If draft_email_rows is empty, the model may have stopped after mail search, or draft_email ran in an earlier assistant bubble (this helper snapshots .message.assistant.last() only). If draft_email_rows has error:true, inspect tool summary.',
      }
      logStep('Steve phase3 DIAG (missing successful draft_email)', diag)
      await test.info().attach('b2b-steve-phase3-assistant.json', {
        body: Buffer.from(JSON.stringify(diag, null, 2), 'utf8'),
        contentType: 'application/json',
      })
    }

    expect(steveDraftOk).toBe(true)
    await expect(steveP3.getByTestId('email-draft-editor')).toBeVisible({ timeout: uiTimeoutMs })

    await stevePhase3Ctx.close()

    logStep('done')
    expect(steveErrors).toEqual([])
  })
})
