import { test, expect } from '@playwright/test'
import { mintEnronDemoSession } from './helpers/mintEnronDemoSession'

function enronDemoSecret(): string | undefined {
  return process.env.BRAIN_ENRON_DEMO_SECRET?.trim()
}

test.describe('Enron demo tenant (Bearer mint)', () => {
  test.beforeEach(() => {
    test.skip(
      !enronDemoSecret(),
      'Set BRAIN_ENRON_DEMO_SECRET in repo .env (loaded by playwright.config) or in the environment',
    )
  })

  test('POST /api/auth/demo/enron returns session cookie when provisioned', async ({
    request,
    baseURL,
  }) => {
    const secret = enronDemoSecret()!
    const { cookie } = await mintEnronDemoSession(request, baseURL!, secret)
    expect(cookie.length).toBeGreaterThan(8)
  })

  test('GET /api/auth/demo/enron/users lists demo personas', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/auth/demo/enron/users`)
    expect(res.ok()).toBeTruthy()
    const body = (await res.json()) as { ok?: boolean; users?: Array<{ key: string }> }
    expect(body.ok).toBe(true)
    expect(body.users?.map(u => u.key).sort()).toEqual(['kean', 'lay', 'skilling'])
  })

  test('GET /api/auth/demo/enron/seed-status is authorized with bearer', async ({
    request,
    baseURL,
  }) => {
    const secret = enronDemoSecret()!
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
    const secret = enronDemoSecret()!
    const { cookie } = await mintEnronDemoSession(request, baseURL!, secret)

    const context = await browser.newContext()
    const host = new URL(baseURL!).hostname
    await context.addCookies([
      {
        name: 'brain_session',
        value: cookie,
        domain: host,
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ])
    const page = await context.newPage()
    const nav = await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' })
    expect(nav?.ok()).toBeTruthy()
    await context.close()
  })
})
