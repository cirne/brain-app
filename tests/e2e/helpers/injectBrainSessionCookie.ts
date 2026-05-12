import type { BrowserContext } from '@playwright/test'

/**
 * Attach `brain_session` for UI tests. Uses cookie `url` = `origin` of `baseURL` so Playwright
 * does not combine conflicting `domain` + `path` attributes (which can drop the cookie).
 */
export async function addBrainSessionCookieToContext(
  context: BrowserContext,
  baseURL: string,
  sessionCookieValue: string,
): Promise<void> {
  const origin = new URL(baseURL).origin
  await context.addCookies([
    {
      name: 'brain_session',
      value: sessionCookieValue,
      url: origin,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ])
}
