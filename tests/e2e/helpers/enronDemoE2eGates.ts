import type { APIRequestContext } from '@playwright/test'
import { getBrainQueryEnabledFromServer } from './brainSharingApi'
import { getEnronDemoSecret } from './enronDemo'

/** Use with Playwright `test.skip` in `test.beforeEach`. */
export type EnronB2BE2eUnavailable =
  | 'missing_brain_enron_demo_secret'
  | 'brain_query_disabled'
  | 'vault_status_unreachable'

const MESSAGES: Record<EnronB2BE2eUnavailable, string> = {
  missing_brain_enron_demo_secret:
    'Set BRAIN_ENRON_DEMO_SECRET in repo .env (loaded by playwright.config) or in the environment',
  brain_query_disabled:
    'Server must run with BRAIN_B2B_ENABLED=1 (vault `brainQueryEnabled`) for brain-query / collaborator routes and UI',
  vault_status_unreachable:
    'Could not read GET /api/vault/status — is the dev server up on PLAYWRIGHT_BASE_URL?',
}

export function enronCollaborationE2eUnavailableMessage(reason: EnronB2BE2eUnavailable): string {
  return MESSAGES[reason]
}

/**
 * Multi-tenant Enron demos that need **brain-query grants**, Settings → Brain access, or **`ask_collaborator`**
 * should `await applyEnronCollaborationE2eGate(test.skip, …)` once per `describe` **`beforeEach`**.
 */
export async function applyEnronCollaborationE2eGate(
  skip: (condition: boolean, description?: string) => void,
  request: APIRequestContext,
  baseURL: string,
): Promise<void> {
  let reason: EnronB2BE2eUnavailable | null = null
  if (!getEnronDemoSecret()) reason = 'missing_brain_enron_demo_secret'
  else {
    try {
      if (!(await getBrainQueryEnabledFromServer(request, baseURL))) reason = 'brain_query_disabled'
    } catch {
      reason = 'vault_status_unreachable'
    }
  }
  if (reason) skip(true, enronCollaborationE2eUnavailableMessage(reason))
}
