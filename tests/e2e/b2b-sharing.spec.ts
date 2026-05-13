import type { APIRequestContext, Page } from '@playwright/test'
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
  getEnronDemoSecret,
  mintFreshEnronDemoCookieForBrowser,
  prepareEnronDemoSessionNoSoftReset,
  provisionEnronDemoPeerForCollaboratorDirectory,
  waitUntilWorkspaceHandlesApiIncludes,
} from './helpers'

/** Matches Phase 1 cold-query outbound text (Ken inbox + Phase 3 transcript). */
const PHASE1_TUNNEL_OUTBOUND_PROMPT = 'please summarize the status with Dynergy merger'

const VIEWPORT_TUNNEL_E2E = { width: 1440, height: 900 } as const

type TunnelTimeouts = {
  uiTimeoutMs: number
  chatPostTimeoutMs: number
  assistantAnswerTimeoutMs: number
}

type LogStep = ReturnType<typeof createStepLogger>['logStep']

function tunnelsRail(page: Page) {
  return page.locator('section.ch-group--tunnels')
}

/** Rail row for outbound tunnel toward Ken (demo handle or seeded display label). */
function kenLayOutgoingTunnelRow(page: Page) {
  return tunnelsRail(page)
    .locator('.ch-row')
    .filter({ hasText: new RegExp(`(${ENRON_DEMO_HANDLE_LAY.replace(/-/g, '\\-')}|Ken Lay)`, 'i') })
}

async function apiPrepareCollaborationDirectory(params: {
  request: APIRequestContext
  base: string
  secret: string
  uiTimeoutMs: number
  logStep: LogStep
}): Promise<string> {
  const { request, base, secret, uiTimeoutMs, logStep } = params
  logStep('[api] Steve tenant session (prepareEnronDemoSessionNoSoftReset, kean)')
  let { sessionCookie: steveCookie } = await prepareEnronDemoSessionNoSoftReset(request, base, secret, {
    timeoutMs: uiTimeoutMs,
    demoUser: 'kean',
  })
  logStep('[api] dismiss unread notifications on Steve tenant')
  await dismissUnreadNotificationsViaApi(request, base, steveCookie)

  logStep('[api] provision Ken Lay in workspace directory (lay persona)')
  await provisionEnronDemoPeerForCollaboratorDirectory(request, base, secret, {
    timeoutMs: uiTimeoutMs,
    demoUser: 'lay',
  })
  logStep('[api] poll workspace-handles until @demo-ken-lay searchable as "ken"', {
    directoryQuery: 'ken',
    handle: ENRON_DEMO_HANDLE_LAY,
  })
  await waitUntilWorkspaceHandlesApiIncludes(request, base, steveCookie, ENRON_DEMO_HANDLE_LAY, {
    timeoutMs: uiTimeoutMs * 4,
    pollMs: 500,
    directoryQuery: 'ken',
  })

  logStep('[api] remint Steve brain_session cookie for browser')
  steveCookie = (await mintFreshEnronDemoCookieForBrowser(request, base, secret, { demoUser: 'kean' })).cookie
  return steveCookie
}

async function phase1SteveColdBraintunnelOutbound(params: {
  stevePage: Page
  base: string
  t: TunnelTimeouts
  logStep: LogStep
}) {
  const { stevePage, base, t, logStep } = params
  logStep('phase 1 start: Steve cold Braintunnel outbound')
  logStep('[p1] goto /c, wait tunnels rail + cold-query button')
  await stevePage.goto(`${base}/c`, { waitUntil: 'domcontentloaded' })
  await expect(stevePage.getByRole('heading', { name: /^tunnels$/i })).toBeVisible({ timeout: t.uiTimeoutMs })
  await expect(stevePage.getByTestId('cold-query-open')).toBeVisible({ timeout: t.uiTimeoutMs })

  const kenRow = kenLayOutgoingTunnelRow(stevePage)
  const existingKenTunnels = await kenRow.count()
  logStep('[p1] tunnels list: Ken row count (0 = skip teardown)', { existingKenTunnels })
  if (existingKenTunnels > 0) {
    logStep('[p1] teardown existing Ken tunnel via header Close Braintunnel + confirm dialog')
    await kenRow.first().click()
    await expect(stevePage.getByRole('button', { name: 'Close Braintunnel' })).toBeVisible({
      timeout: t.uiTimeoutMs,
    })
    await stevePage.getByRole('button', { name: 'Close Braintunnel' }).click()
    await stevePage.getByRole('button', { name: 'Close tunnel' }).click({ timeout: t.uiTimeoutMs })
    await expect(kenRow).toHaveCount(0, { timeout: t.uiTimeoutMs })
    logStep('[p1] Ken tunnel row removed from rail')
  }

  logStep('[p1] open cold-tunnel composer (Open a Braintunnel)')
  await stevePage.getByTestId('cold-query-open').click()
  const composerRoot = stevePage.getByTestId('cold-tunnel-composer')
  await expect(composerRoot).toBeVisible({ timeout: t.uiTimeoutMs })

  logStep('[p1] workspace search demo-ken, pick suggestion', { suggestionHandle: ENRON_DEMO_HANDLE_LAY })
  await composerRoot.locator('#cold-tunnel-search').fill('demo-ken')
  const pickOption = stevePage
    .locator('[id="cold-tunnel-suggest-list"] [role="option"]')
    .filter({ hasText: ENRON_DEMO_HANDLE_LAY })
    .first()
  await expect(pickOption).toBeVisible({ timeout: t.uiTimeoutMs })
  await pickOption.click()

  logStep('[p1] fill cold-query message body + POST /api/chat/b2b/cold-query', {
    promptPreview: `${PHASE1_TUNNEL_OUTBOUND_PROMPT.slice(0, 48)}…`,
  })
  await composerRoot.locator('#cold-tunnel-msg').fill(PHASE1_TUNNEL_OUTBOUND_PROMPT)
  const coldPost = stevePage.waitForResponse(
    (res) =>
      res.url().includes('/api/chat/b2b/cold-query') &&
      res.request().method() === 'POST' &&
      res.ok(),
    { timeout: t.chatPostTimeoutMs },
  )
  await composerRoot.getByRole('button', { name: /^send$/i }).click()
  const coldPostRes = await coldPost
  logStep('[p1] cold-query response', { ok: coldPostRes.ok(), status: coldPostRes.status() })
  expect(coldPostRes.ok()).toBeTruthy()

  logStep('[p1] assert user bubble visible')
  await expect(stevePage.getByText(PHASE1_TUNNEL_OUTBOUND_PROMPT, { exact: true })).toBeVisible({
    timeout: t.uiTimeoutMs,
  })
  logStep('[p1] assert awaiting-peer-review receipt banner')
  await expect(
    stevePage.getByText(
      'Your message was sent. When they approve their assistant\'s draft, the reply will appear here.',
    ),
  ).toBeVisible({ timeout: t.uiTimeoutMs })
  logStep('phase 1 done')
}

/**
 * Leave the outbound thread so `/api/events` tunnel_activity can mark the rail unread dot
 * (`ChatHistory` skips unread while that session is active).
 */
async function steveRailReadyForUnreadDot(params: {
  stevePage: Page
  t: TunnelTimeouts
  logStep: LogStep
}) {
  const { stevePage, t, logStep } = params
  logStep('[between p1→p3] Steve: new/empty chat (not viewing outbound tunnel) so hub unread dot can attach')
  await ensureEmptyChatComposerContext(stevePage, { uiTimeoutMs: t.uiTimeoutMs })
  logStep('[between p1→p3] empty composer context ready')
}

async function phase2KenInboxApprovesDraft(params: {
  kenPage: Page
  t: TunnelTimeouts
  logStep: LogStep
}) {
  const { kenPage, t, logStep } = params
  logStep('phase 2 start: Ken Inbox approve')

  await expect(kenPage.getByRole('heading', { name: /^tunnels$/i })).toBeVisible({ timeout: t.uiTimeoutMs })
  logStep('[p2] Ken /c tunnels rail visible')

  const kenTunnels = tunnelsRail(kenPage)
  const kenInbox = kenTunnels.getByRole('button', { name: /open inbox/i })
  await expect(kenInbox).toBeVisible({ timeout: t.assistantAnswerTimeoutMs })
  const kenBadgeText = (await kenInbox.locator('.inbox-rail-badge').innerText()).trim()
  const kenPending = kenBadgeText.includes('+') ? 100 : Number.parseInt(kenBadgeText, 10)
  logStep('[p2] Inbox rail link + badge', { kenBadgeText, parsedPending: kenPending })
  expect(kenPending).toBe(1)

  logStep('[p2] click Open inbox → review queue split')
  await kenInbox.click()
  await expect(kenPage.getByTestId('review-queue-split')).toBeVisible({ timeout: t.uiTimeoutMs })
  const matchingInboxRows = kenPage
    .getByTestId('review-queue-row')
    .filter({ hasText: `@${ENRON_DEMO_HANDLE_KEAN}` })
    .filter({ hasText: /Dynergy merger/i })
  await expect(matchingInboxRows).toHaveCount(1, { timeout: t.uiTimeoutMs })
  const inboxRow = matchingInboxRows.first()
  logStep('[p2] single matching inbox row (Steve cold query snippet)', {
    filters: `@${ENRON_DEMO_HANDLE_KEAN}`,
    snippet: 'Dynergy merger',
  })
  await expect(inboxRow).toBeVisible({ timeout: t.assistantAnswerTimeoutMs })
  await inboxRow.click()
  logStep('[p2] selected inbox row → review-detail')

  const detail = kenPage.getByTestId('review-detail')
  await expect(detail).toBeVisible({ timeout: t.uiTimeoutMs })
  await expect(detail.locator('.review-reply-body')).toBeVisible({ timeout: t.uiTimeoutMs })

  const sendBtn = detail.locator('.review-detail-actions').getByRole('button', { name: /^send$/i })
  logStep('[p2] wait TipTap draft + Send enabled (pending inbound)')
  await expect(sendBtn).toBeEnabled({ timeout: t.assistantAnswerTimeoutMs })

  logStep('[p2] poll reply body character count (>80)')
  await expect
    .poll(async () => (await detail.locator('.review-reply-body').innerText()).trim().length, {
      timeout: t.assistantAnswerTimeoutMs,
    })
    .toBeGreaterThan(80)

  logStep('[p2] POST /api/chat/b2b/approve (Send)')
  const approvePost = kenPage.waitForResponse(
    (res) =>
      res.url().includes('/api/chat/b2b/approve') &&
      res.request().method() === 'POST' &&
      res.ok(),
    { timeout: t.chatPostTimeoutMs },
  )
  await sendBtn.click()
  const approveRes = await approvePost
  logStep('[p2] approve response', { ok: approveRes.ok(), status: approveRes.status() })
  expect(approveRes.ok()).toBeTruthy()
  logStep('phase 2 done')
}

async function phase3SteveSeesUnreadDotThenTranscript(params: {
  stevePage: Page
  t: TunnelTimeouts
  logStep: LogStep
}) {
  const { stevePage, t, logStep } = params
  logStep('phase 3 start: Steve tunnel rail unread dot + transcript')

  const steveKenRow = kenLayOutgoingTunnelRow(stevePage)
  await expect(steveKenRow).toBeVisible({ timeout: t.uiTimeoutMs })
  logStep('[p3] Ken tunnel row visible under Tunnels; wait data-tunnel-indicator=new-reply (hub SSE)')
  await expect(steveKenRow.locator('[data-tunnel-indicator="new-reply"]')).toBeVisible({
    timeout: t.assistantAnswerTimeoutMs,
  })
  logStep('[p3] new-reply dot visible on tunnel row')

  logStep('[p3] click Ken tunnel row → open outbound thread')
  await steveKenRow.click()
  logStep('[p3] assert original outbound prompt bubble')
  await expect(stevePage.getByText(PHASE1_TUNNEL_OUTBOUND_PROMPT, { exact: true })).toBeVisible({
    timeout: t.uiTimeoutMs,
  })
  logStep('[p3] wait assistant merger reply in transcript')
  await expect(
    stevePage.locator('.message.assistant').filter({ hasText: /dynergy merger|dynegy|status.*merger/i }),
  ).toBeVisible({ timeout: t.assistantAnswerTimeoutMs })
  logStep('phase 3 done')
}

/**
 * Braintunnel flows (cold query → approve → SSE unread rail). Shares Enron `./data` demo tenants with
 * other specs; prefer `playwright --workers=1` if suites race locally. Phase 3’s rail dot requires a
 * live `tunnel_activity` hub event; Steve stays on `/c` in an empty thread before Ken hits Send.
 */
test.describe('Braintunnel (Steve Kean ↔ Ken Lay)', () => {
  test.beforeEach(async ({ request, baseURL }) => {
    await applyEnronCollaborationE2eGate(test.skip, request, baseURL!)
  })

  test('end-to-end: cold query → Ken approves draft → Steve sees unread dot + reply', async ({
    browser,
    request,
    baseURL,
  }) => {
    const t = {
      uiTimeoutMs: ENRON_B2B_AGENT_TIMEOUTS.uiTimeoutMs,
      chatPostTimeoutMs: ENRON_B2B_AGENT_TIMEOUTS.chatPostTimeoutMs,
      assistantAnswerTimeoutMs: ENRON_B2B_AGENT_TIMEOUTS.assistantAnswerTimeoutMs,
    } satisfies TunnelTimeouts
    test.setTimeout(ENRON_B2B_AGENT_TIMEOUTS.testTimeoutMs)

    const { logStep } = createStepLogger('braintunnel-e2e')
    logStep('[setup] test body start', {
      testTimeoutMs: ENRON_B2B_AGENT_TIMEOUTS.testTimeoutMs,
      uiTimeoutMs: t.uiTimeoutMs,
      chatPostTimeoutMs: t.chatPostTimeoutMs,
      assistantAnswerTimeoutMs: t.assistantAnswerTimeoutMs,
    })
    const secret = getEnronDemoSecret()!
    const base = baseURL!

    logStep('[setup] API + Steve cookie (Ken directory + session)')
    const steveCookie = await apiPrepareCollaborationDirectory({ request, base, secret, uiTimeoutMs: t.uiTimeoutMs, logStep })
    logStep('[setup] mint Ken Lay session cookie')
    const kenCookie = (await mintFreshEnronDemoCookieForBrowser(request, base, secret, { demoUser: 'lay' })).cookie

    const steveErrors: string[] = []
    const kenErrors: string[] = []
    logStep('[setup] new browser contexts (viewport)', VIEWPORT_TUNNEL_E2E)
    const steveCtx = await browser.newContext({ viewport: VIEWPORT_TUNNEL_E2E })
    const kenCtx = await browser.newContext({ viewport: VIEWPORT_TUNNEL_E2E })
    await addBrainSessionCookieToContext(steveCtx, base, steveCookie)
    await addBrainSessionCookieToContext(kenCtx, base, kenCookie)
    logStep('[setup] brain_session injected for both contexts')
    const stevePage = await steveCtx.newPage()
    const kenPage = await kenCtx.newPage()
    attachAssistantChatPageDiagnostics(stevePage, { logTag: 'braintunnel-steve', runtimeErrors: steveErrors })
    attachAssistantChatPageDiagnostics(kenPage, { logTag: 'braintunnel-ken', runtimeErrors: kenErrors })
    logStep('[setup] pages + browser diagnostics attached (stevePage, kenPage)')

    try {
      await phase1SteveColdBraintunnelOutbound({ stevePage, base, t, logStep })
      await steveRailReadyForUnreadDot({ stevePage, t, logStep })

      logStep('[between p2] Ken.goto /c for Inbox rail')
      await kenPage.goto(`${base}/c`, { waitUntil: 'domcontentloaded' })
      await phase2KenInboxApprovesDraft({ kenPage, t, logStep })
      await phase3SteveSeesUnreadDotThenTranscript({ stevePage, t, logStep })

      logStep('test body finished; closing contexts')
    } finally {
      logStep('[teardown] close Steve + Ken contexts')
      await steveCtx.close().catch(() => {})
      await kenCtx.close().catch(() => {})
    }
    expect(steveErrors).toEqual([])
    expect(kenErrors).toEqual([])
  })
})
