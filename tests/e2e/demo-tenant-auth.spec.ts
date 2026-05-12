import { test, expect } from '@playwright/test'
import {
  addBrainSessionCookieToContext,
  ENRON_DEMO_PERSONAS,
  getEnronDemoSecret,
  mintEnronDemoSession,
} from './helpers'

test.describe('Enron demo tenant (Bearer mint)', () => {
  test.beforeEach(() => {
    test.skip(
      !getEnronDemoSecret(),
      'Set BRAIN_ENRON_DEMO_SECRET in repo .env (loaded by playwright.config) or in the environment',
    )
  })

  test('POST /api/auth/demo/enron returns session cookie when provisioned', async ({
    request,
    baseURL,
  }) => {
    const secret = getEnronDemoSecret()!
    const { cookie } = await mintEnronDemoSession(request, baseURL!, secret)
    expect(cookie.length).toBeGreaterThan(8)
  })

  test('GET /api/auth/demo/enron/users lists demo personas', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/auth/demo/enron/users`)
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { ok?: boolean; users?: Array<{ key: string }> }
    expect(body.ok).toBe(true)
    expect(body.users?.map(u => u.key).sort()).toEqual([...ENRON_DEMO_PERSONAS].sort())
  })

  test('GET /api/auth/demo/enron/seed-status is authorized with bearer', async ({
    request,
    baseURL,
  }) => {
    const secret = getEnronDemoSecret()!
    const res = await request.get(`${baseURL}/api/auth/demo/enron/seed-status?demoUser=kean`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { ok?: boolean; seed?: { status?: string }; demoUser?: string }
    expect(body.ok).toBe(true)
    expect(body.demoUser).toBe('kean')
    expect(['ready', 'running', 'idle', 'failed']).toContain(body.seed?.status ?? '')
  })

  test('browser context can attach brain_session and load app', async ({ browser, request, baseURL }) => {
    const secret = getEnronDemoSecret()!
    const { cookie } = await mintEnronDemoSession(request, baseURL!, secret)

    const context = await browser.newContext()
    await addBrainSessionCookieToContext(context, baseURL!, cookie)
    const page = await context.newPage()
    const nav = await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' })
    expect(nav?.ok()).toBeTruthy()
    await context.close()
  })
})
