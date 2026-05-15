import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Tunnels page (`/settings/brain-access`): “Policies & collaborators” (see `access.json`). */
export async function expectBrainAccessListHeadingVisible(
  page: Page,
  opts?: { timeout?: number },
): Promise<void> {
  await expect(page.getByRole('heading', { name: /Policies & collaborators/i })).toBeVisible({
    timeout: opts?.timeout,
  })
}

/**
 * Session cookie must already be injected. Hits `/c` first (same warmup as assistant smoke) so `/settings/brain-access`
 * opens in a signed-in shell rather than bouncing or rendering empty.
 */
export async function gotoBrainAccessViaChatWarmup(
  page: Page,
  baseURL: string,
  opts?: { uiTimeoutMs?: number },
): Promise<void> {
  const ui = opts?.uiTimeoutMs ?? 20_000
  await page.goto(`${baseURL}/c`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('.chat-textarea')).toBeVisible({ timeout: ui })

  await page.goto(`${baseURL}/settings/brain-access`, { waitUntil: 'domcontentloaded' })
  await expectBrainAccessListHeadingVisible(page, { timeout: ui })
}
