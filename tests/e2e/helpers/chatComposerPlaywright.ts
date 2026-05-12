import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * On `/c`, the “new chat” control only mounts once there is transcript history (`showComposerNewChat`).
 * An empty restore has **no** button — click only when visible, then assert an empty-thread shell.
 *
 * Mirrors `assistant-chat-smoke.spec.ts`: use before flows that assume a cleared composer strip.
 */
export async function ensureEmptyChatComposerContext(
  page: Page,
  opts?: { uiTimeoutMs?: number },
): Promise<void> {
  const ui = opts?.uiTimeoutMs ?? 20_000
  const newChat = page.locator('.input-composer button.new-chat-btn')
  if (await newChat.isVisible().catch(() => false)) {
    await expect(newChat).toBeVisible({ timeout: ui })
    await newChat.click()
  }
  await expect(page.locator('[data-conversation-state="empty"]')).toBeVisible({ timeout: ui })
}

export async function openNewChatIfPresent(page: Page, opts?: { uiTimeoutMs?: number }): Promise<void> {
  const ui = opts?.uiTimeoutMs ?? 20_000
  const newChat = page.locator('.input-composer button.new-chat-btn')
  if (await newChat.isVisible().catch(() => false)) {
    await expect(newChat).toBeVisible({ timeout: ui })
    await newChat.click()
  }
}

/** Warm `/c` and wait for composer; optionally click new-chat once so downstream steps see an empty transcript. */
export async function gotoChatComposerVisible(page: Page, opts?: {
  baseURL?: string
  /** Default `/c` */
  path?: string
  openNewChatIfNeeded?: boolean
  uiTimeoutMs?: number
}): Promise<void> {
  const base = opts?.baseURL ?? ''
  const path = opts?.path ?? '/c'
  const ui = opts?.uiTimeoutMs ?? 20_000
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })

  const empty = page.locator('[data-conversation-state="empty"]')
  if (opts?.openNewChatIfNeeded !== false && !(await empty.isVisible().catch(() => false))) {
    await openNewChatIfPresent(page, { uiTimeoutMs: ui })
  }
  await expect(page.locator('.chat-textarea')).toBeVisible({ timeout: ui })
}

export function chatTextareaLocator(page: Page): Locator {
  return page.locator('.chat-textarea')
}
