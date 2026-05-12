import type { Page, Response } from '@playwright/test'

/** `POST /api/chat` completion (matches URL prefix used by streaming client). */
export function isChatPostApiResponse(res: Response): boolean {
  const u = res.url()
  return res.request().method() === 'POST' && (u.includes('/api/chat') || u.endsWith('/api/chat'))
}

/**
 * Inspect the **outgoing** POST body (Playwright `request.postData()`), same pattern as assistant / B2B specs
 * that wait for `/api/chat` with a prompt substring.
 */
export function chatPostRequestBodyIncludes(res: Response, needle: string): boolean {
  if (!isChatPostApiResponse(res)) return false
  try {
    return (res.request().postData() ?? '').includes(needle)
  } catch {
    return false
  }
}

export function waitForChatPostRequestIncluding(
  page: Page,
  needle: string,
  opts?: { timeout?: number },
): Promise<Response> {
  return page.waitForResponse((res) => chatPostRequestBodyIncludes(res, needle), {
    timeout: opts?.timeout,
  })
}
