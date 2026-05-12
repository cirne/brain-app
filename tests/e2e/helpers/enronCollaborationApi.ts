/**
 * Convenience name: before **another** tenant grants access in the Brain Access directory, the recipient
 * tenant must appear in **`GET /api/account/workspace-handles`**. Provision that peer session + indexing + onboarding-done.
 */

import type { APIRequestContext } from '@playwright/test'

import type { PrepareEnronDemoSessionNoSoftResetOptions } from './prepareEnronDemoSessionNoSoftReset'
import { prepareEnronDemoSessionNoSoftReset } from './prepareEnronDemoSessionNoSoftReset'

export async function provisionEnronDemoPeerForCollaboratorDirectory(
  request: APIRequestContext,
  baseURL: string,
  secret: string,
  options: PrepareEnronDemoSessionNoSoftResetOptions,
): Promise<{ sessionCookie: string }> {
  return prepareEnronDemoSessionNoSoftReset(request, baseURL, secret, options)
}
