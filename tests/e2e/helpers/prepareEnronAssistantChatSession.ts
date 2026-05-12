import { expect, type APIRequestContext } from '@playwright/test'
import { DEFAULT_ENRON_DEMO_PERSONA, type EnronDemoPersona } from './enronDemo'
import { mintEnronDemoSession } from './mintEnronDemoSession'

export type PrepareEnronAssistantChatSessionOptions = {
  timeoutMs: number
  /** Demo persona / tenant (`kean` default). */
  demoUser?: EnronDemoPersona
  /** Pass `createStepLogger(...).logStep` for verbose CI debugging */
  logStep?: (msg: string, extra?: unknown) => void
}

/**
 * Shared precondition for Enron-demo assistant UI tests:
 * mint → confirm handle if needed → dev soft-reset → skip onboarding kickoff (PATCH done if stuck in onboarding-agent) → remint cookie.
 * Requires dev server (`POST /api/dev/soft-reset`).
 */
export async function prepareEnronAssistantChatSession(
  request: APIRequestContext,
  baseURL: string,
  secret: string,
  options: PrepareEnronAssistantChatSessionOptions,
): Promise<{ sessionCookie: string }> {
  const { timeoutMs, logStep } = options
  const demoUser = options.demoUser ?? DEFAULT_ENRON_DEMO_PERSONA
  const mintOpts = { demoUser }
  const log = logStep ?? ((_msg: string, _extra?: unknown) => {})

  log('mint demo session cookie', { demoUser })
  let sessionCookie = (await mintEnronDemoSession(request, baseURL, secret, mintOpts)).cookie
  log('minted demo session cookie', { cookieLength: sessionCookie.length })

  const sessionHeaders = () => ({ Cookie: `brain_session=${sessionCookie}` })

  log('GET /api/account/handle')
  const handleRes = await request.get(`${baseURL}/api/account/handle`, {
    headers: sessionHeaders(),
    timeout: timeoutMs,
  })
  log('received /api/account/handle', { status: handleRes.status() })
  expect(handleRes.ok()).toBeTruthy()
  const handleBody = (await handleRes.json()) as { handle?: string; confirmedAt?: string | null }
  log('parsed handle payload', {
    handle: handleBody.handle ?? null,
    confirmed: Boolean(handleBody.confirmedAt),
  })
  if (!handleBody.confirmedAt && typeof handleBody.handle === 'string' && handleBody.handle.trim()) {
    log('POST /api/account/handle/confirm', { handle: handleBody.handle })
    const confirmHandleRes = await request.post(`${baseURL}/api/account/handle/confirm`, {
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      data: JSON.stringify({ handle: handleBody.handle }),
      timeout: timeoutMs,
    })
    log('received /api/account/handle/confirm', { status: confirmHandleRes.status() })
    expect(confirmHandleRes.ok()).toBeTruthy()
  }

  log('POST /api/dev/soft-reset')
  const softResetRes = await request.post(`${baseURL}/api/dev/soft-reset`, {
    headers: sessionHeaders(),
    timeout: timeoutMs,
  })
  log('received /api/dev/soft-reset', { status: softResetRes.status() })
  expect(softResetRes.ok()).toBeTruthy()

  log('GET /api/onboarding/status')
  const onboardingStatusRes = await request.get(`${baseURL}/api/onboarding/status`, {
    headers: sessionHeaders(),
    timeout: timeoutMs,
  })
  log('received /api/onboarding/status', { status: onboardingStatusRes.status() })
  expect(onboardingStatusRes.ok()).toBeTruthy()
  const onboardingStatus = (await onboardingStatusRes.json()) as { state?: string }
  log('parsed onboarding state', { state: onboardingStatus.state ?? null })
  expect(['onboarding-agent', 'done']).toContain(onboardingStatus.state ?? '')
  if (onboardingStatus.state === 'onboarding-agent') {
    log('PATCH /api/onboarding/state -> done (avoid onboarding kickoff stream)')
    const onboardingDoneRes = await request.patch(`${baseURL}/api/onboarding/state`, {
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      data: JSON.stringify({ state: 'done' }),
      timeout: timeoutMs,
    })
    log('received /api/onboarding/state -> done', { status: onboardingDoneRes.status() })
    expect(onboardingDoneRes.ok()).toBeTruthy()
  }

  log('remint demo session cookie after soft-reset', { demoUser })
  sessionCookie = (await mintEnronDemoSession(request, baseURL, secret, mintOpts)).cookie
  log('reminted demo session cookie', { cookieLength: sessionCookie.length })

  return { sessionCookie }
}
