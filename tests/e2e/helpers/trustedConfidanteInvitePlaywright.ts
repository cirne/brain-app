import type { APIRequestContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'

import { workspaceDirectoryApiJsonIncludesHandle } from '../../../src/shared/workspaceHandlesResponse.js'

/**
 * Poll as **callerSessionCookie** (`GET /api/account/workspace-handles?q=`) until **`results`** lists **`handle`**.
 *
 * Important: endpoint **requires tenant session**. Optional **`q`** scopes results (recommended — empty-query
 * listings are capped at the default directory limit).
 */
export async function waitUntilWorkspaceHandlesApiIncludes(
  request: APIRequestContext,
  baseURL: string,
  callerSessionCookie: string,
  handle: string,
  opts?: { timeoutMs?: number; pollMs?: number; directoryQuery?: string; requestTimeoutMs?: number },
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 30_000
  const pollMs = opts?.pollMs ?? 500
  /** Match pickers — last segment tends to discriminate `demo-*` personas. */
  const qRaw = opts?.directoryQuery ?? handle.replace(/^demo-[^-]+-/, '')
  const q = encodeURIComponent(qRaw)
  const reqTimeout = opts?.requestTimeoutMs ?? Math.min(timeoutMs, 60_000)
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const res = await request
      .get(`${baseURL}/api/account/workspace-handles?q=${q}`, {
        headers: { Cookie: `brain_session=${callerSessionCookie}` },
        timeout: reqTimeout,
      })
      .catch(() => null)

    if (res?.ok()) {
      const j = await res.json().catch(() => null)
      if (workspaceDirectoryApiJsonIncludesHandle(j, handle)) return
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(
    `Timed out (${timeoutMs}ms) waiting for /api/account/workspace-handles?q=${qRaw} to include @${handle}`,
  )
}

export type InviteTrustedCollaboratorViaSearchOpts = {
  collaboratorHandle: string
  /** Typed into “Search @handle or name” — substring of the collaborator’s workspace handle or display name */
  searchQuery: string
  uiTimeoutMs?: number
}

/**
 * Brain Access list → **Trusted Confidante** card → **Add** → search dropdown (`add-user-dropdown-option`).
 *
 * Prerequisites: collaborator tenant already synced so `/api/account/workspace-handles` can return them once the
 * search runs (helpers often **`waitUntilWorkspaceHandlesApiIncludes`** or **`provisionEnronDemoPeerForCollaboratorDirectory`** first).
 */
export async function inviteTrustedCollaboratorViaSearch(
  page: Page,
  opts: InviteTrustedCollaboratorViaSearchOpts,
): Promise<void> {
  const ui = opts.uiTimeoutMs ?? 20_000
  const trustedCard = page.locator('.policy-card').filter({ hasText: /trusted confidante/i })
  await expect(trustedCard).toHaveCount(1)
  await trustedCard.getByRole('button', { name: /^Add$/ }).click()

  await expect(page.getByPlaceholder(/Search @handle or name/i)).toBeVisible({ timeout: ui })
  const suggestRes = page.waitForResponse(
    (res) =>
      res.url().includes('/api/account/workspace-handles') &&
      res.request().method() === 'GET' &&
      res.ok(),
    { timeout: ui },
  )
  await page.getByPlaceholder(/Search @handle or name/i).fill(opts.searchQuery)
  await suggestRes

  const option = page
    .locator('.add-user-dropdown-option')
    .filter({ hasText: `@${opts.collaboratorHandle}` })
  await expect(option).toBeVisible({ timeout: ui })
  await option.click()
  await expect(
    trustedCard.getByRole('button', { name: new RegExp(`@${opts.collaboratorHandle}\\b`) }),
  ).toBeVisible({
    timeout: ui,
  })
}
