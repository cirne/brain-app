import { test, expect, type Response as PlaywrightResponse } from '@playwright/test'
import {
  addBrainSessionCookieToContext,
  attachAssistantChatPageDiagnostics,
  CHAT_SMOKE_TIMEOUTS,
  createStepLogger,
  DEFAULT_ENRON_DEMO_PERSONA,
  getEnronDemoSecret,
  prepareEnronAssistantChatSession,
  waitForAssistantReply,
  type EnronDemoPersona,
} from './helpers'

test.describe('Assistant chat smoke (Enron demo tenant)', () => {
  test.beforeEach(() => {
    test.skip(
      !getEnronDemoSecret(),
      'Set BRAIN_ENRON_DEMO_SECRET in repo .env (loaded by playwright.config) or in the environment',
    )
  })

  test('chat smoke: start new chat and ask email question without runtime blowups', async ({
    browser,
    request,
    baseURL,
  }) => {
    const { testTimeoutMs, uiTimeoutMs, chatPostTimeoutMs, assistantAnswerTimeoutMs } =
      CHAT_SMOKE_TIMEOUTS
    test.setTimeout(testTimeoutMs)
    const { logStep } = createStepLogger('chat-smoke')
    const demoUser: EnronDemoPersona = DEFAULT_ENRON_DEMO_PERSONA

    logStep('start', {
      baseURL,
      demoUser,
      testTimeoutMs,
      uiTimeoutMs,
      chatPostTimeoutMs,
      assistantAnswerTimeoutMs,
    })
    const secret = getEnronDemoSecret()!

    const { sessionCookie } = await prepareEnronAssistantChatSession(request, baseURL!, secret, {
      timeoutMs: uiTimeoutMs,
      demoUser,
      logStep,
    })

    logStep('create browser context and inject brain_session cookie')
    const context = await browser.newContext()
    await addBrainSessionCookieToContext(context, baseURL!, sessionCookie)

    const runtimeErrors: string[] = []
    const page = await context.newPage()
    attachAssistantChatPageDiagnostics(page, { logTag: 'chat-smoke', runtimeErrors })

    const isChatPostFor = (needle: string) => (res: PlaywrightResponse) =>
      res.url().includes('/api/chat') &&
      res.request().method() === 'POST' &&
      (res.request().postData() ?? '').includes(needle)

    logStep('navigate to /c')
    await page.goto(`${baseURL}/c`, { waitUntil: 'domcontentloaded' })
    const composer = page.locator('.chat-textarea')
    logStep('wait for composer visible', { selector: '.chat-textarea' })
    await expect(composer).toBeVisible({ timeout: uiTimeoutMs })
    logStep('composer visible')

    const firstPrompt = 'Say hello in one short sentence.'
    logStep('send first prompt', { firstPrompt })
    const firstChatPost = page.waitForResponse(isChatPostFor(firstPrompt), {
      timeout: chatPostTimeoutMs,
    })
    await composer.fill(firstPrompt)
    await composer.press('Enter')
    const firstChatResponse = await firstChatPost
    logStep('received first /api/chat response', {
      status: firstChatResponse.status(),
      ok: firstChatResponse.ok(),
    })
    expect(firstChatResponse.ok()).toBeTruthy()

    const composerNewChat = page.locator('.input-composer button.new-chat-btn')
    logStep('click composer new chat button', { selector: '.input-composer button.new-chat-btn' })
    await expect(composerNewChat).toBeVisible()
    await composerNewChat.click()
    await expect(page.locator('[data-conversation-state="empty"]')).toBeVisible()
    logStep('new chat empty state visible')

    const emailQuestion = "Summarize karen.denne@enron.com emails sent to me in the last week";
    logStep('send email question', { emailQuestion })
    const secondChatPost = page.waitForResponse(isChatPostFor(emailQuestion), {
      timeout: chatPostTimeoutMs,
    })
    await composer.fill(emailQuestion)
    await composer.press('Enter')
    const secondChatResponse = await secondChatPost
    logStep('received second /api/chat response', {
      status: secondChatResponse.status(),
      ok: secondChatResponse.ok(),
    })
    expect(secondChatResponse.ok()).toBeTruthy()

    logStep('wait for assistant answer to render and stream to finish')
    const reply = await waitForAssistantReply(page, { timeoutMs: assistantAnswerTimeoutMs })
    await expect(page.locator('.message.assistant').last()).not.toContainText('Connection error:')
    logStep('assistant reply snapshot', {
      assistantText: reply.assistantText,
      tools: reply.tools,
    })
    expect(reply.assistantText.toLowerCase()).toContain('lunch')

    logStep('runtime page errors captured', { count: runtimeErrors.length })
    expect(runtimeErrors).toEqual([])

    logStep('close browser context')
    await context.close()
    logStep('done')
  })
})
