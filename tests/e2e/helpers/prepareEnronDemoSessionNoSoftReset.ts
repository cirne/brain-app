import { expect, type APIRequestContext } from '@playwright/test'
import type { EnronDemoPersona } from './enronDemo'
import { DEFAULT_ENRON_DEMO_PERSONA } from './enronDemo'
import { mintEnronDemoSession } from './mintEnronDemoSession'

export type PrepareEnronDemoSessionNoSoftResetOptions = {
  timeoutMs: number
  demoUser?: EnronDemoPersona
}

async function getOnboardingState(
  request: APIRequestContext,
  baseURL: string,
  sessionCookie: string,
  timeoutMs: number,
): Promise<string> {
  const onboardingStatusRes = await request.get(`${baseURL}/api/onboarding/status`, {
    headers: { Cookie: `brain_session=${sessionCookie}` },
    timeout: timeoutMs,
  })
  expect(onboardingStatusRes.ok()).toBeTruthy()
  const onboardingStatus = (await onboardingStatusRes.json()) as { state?: string }
  const s = (onboardingStatus.state ?? '').trim()
  expect(s.length).toBeGreaterThan(0)
  return s
}

async function patchOnboardingState(
  request: APIRequestContext,
  baseURL: string,
  sessionCookie: string,
  next: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; bodyPreview: string }> {
  const res = await request.patch(`${baseURL}/api/onboarding/state`, {
    headers: {
      Cookie: `brain_session=${sessionCookie}`,
      'Content-Type': 'application/json',
    },
    data: JSON.stringify({ state: next }),
    timeout: timeoutMs,
  })
  const text = (await res.text()).slice(0, 280)
  return { ok: res.ok(), status: res.status(), bodyPreview: text }
}

/**
 * Drive hosted onboarding toward `done` without soft-reset — needed for seeded Enron personas that
 * are still `not-started` / `indexing` locally.
 */
async function advanceOnboardingToDone(
  request: APIRequestContext,
  baseURL: string,
  sessionCookie: string,
  timeoutMs: number,
): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const state = await getOnboardingState(request, baseURL, sessionCookie, timeoutMs)
    if (state === 'done') return

    if (state === 'onboarding-agent') {
      const r = await patchOnboardingState(request, baseURL, sessionCookie, 'done', timeoutMs)
      expect(r.ok, r.bodyPreview).toBeTruthy()
      continue
    }
    if (state === 'confirming-handle') {
      const r = await patchOnboardingState(request, baseURL, sessionCookie, 'indexing', timeoutMs)
      expect(r.ok, r.bodyPreview).toBeTruthy()
      continue
    }
    if (state === 'not-started') {
      const r = await patchOnboardingState(request, baseURL, sessionCookie, 'indexing', timeoutMs)
      expect(r.ok, r.bodyPreview).toBeTruthy()
      continue
    }
    if (state === 'indexing') {
      const indexingWaitBudgetMs = Math.max(timeoutMs * 10, 180_000)
      const deadline = Date.now() + indexingWaitBudgetMs
      let advanced = false
      let lastBody = ''
      while (Date.now() < deadline) {
        const r = await patchOnboardingState(request, baseURL, sessionCookie, 'onboarding-agent', timeoutMs)
        if (r.ok) {
          advanced = true
          break
        }
        lastBody = r.bodyPreview
        const mailGatePending =
          r.status === 400 &&
          (/messages indexed/i.test(r.bodyPreview) ||
            /download more/i.test(r.bodyPreview) ||
            /try again in a few minutes/i.test(r.bodyPreview))
        if (!mailGatePending) {
          throw new Error(
            `Could not PATCH onboarding indexing → onboarding-agent (${r.status}): ${r.bodyPreview}`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
      if (!advanced) {
        throw new Error(
          `Timed out waiting for mail index gate (${indexingWaitBudgetMs}ms). Last PATCH body: ${lastBody}`,
        )
      }
      continue
    }
    throw new Error(`Unexpected onboarding state "${state}" for Enron demo e2e (cannot reach done)`)
  }
  throw new Error('advanceOnboardingToDone loop exceeded')
}

/**
 * Mint + confirm handle + skip onboarding kickoff stream — **does not** call `/api/dev/soft-reset`,
 * because soft reset wipes `brain_query_grants` / notifications for cross-brain demos.
 */
export async function prepareEnronDemoSessionNoSoftReset(
  request: APIRequestContext,
  baseURL: string,
  secret: string,
  options: PrepareEnronDemoSessionNoSoftResetOptions,
): Promise<{ sessionCookie: string }> {
  const demoUser = options.demoUser ?? DEFAULT_ENRON_DEMO_PERSONA
  const timeoutMs = options.timeoutMs
  let sessionCookie = (
    await mintEnronDemoSession(request, baseURL, secret, { demoUser, timeoutMs: options.timeoutMs })
  ).cookie

  const sessionHeaders = () => ({ Cookie: `brain_session=${sessionCookie}` })

  const handleRes = await request.get(`${baseURL}/api/account/handle`, {
    headers: sessionHeaders(),
    timeout: timeoutMs,
  })
  expect(handleRes.ok()).toBeTruthy()
  const handleBody = (await handleRes.json()) as { handle?: string; confirmedAt?: string | null }
  if (!handleBody.confirmedAt && typeof handleBody.handle === 'string' && handleBody.handle.trim()) {
    const confirmHandleRes = await request.post(`${baseURL}/api/account/handle/confirm`, {
      headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      data: JSON.stringify({ handle: handleBody.handle }),
      timeout: timeoutMs,
    })
    expect(confirmHandleRes.ok()).toBeTruthy()
  }

  await advanceOnboardingToDone(request, baseURL, sessionCookie, timeoutMs)

  sessionCookie = (
    await mintEnronDemoSession(request, baseURL, secret, { demoUser, timeoutMs: options.timeoutMs })
  ).cookie
  return { sessionCookie }
}
