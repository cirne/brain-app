import { mkdir } from 'node:fs/promises'
import { isMultiTenantMode, globalDir } from './dataRoot.js'
import { resolveBrainHomeDiskRoot } from './brainHome.js'
import { brainLayoutIssuesDir, brainLayoutVarDir } from './brainLayout.js'
import { tryGetTenantContext } from './tenantContext.js'

/**
 * On-disk "brain home" for list/fetch with embed key (global queue in MT; user home in ST).
 */
export function getGlobalFeedbackBrainHome(): string {
  if (isMultiTenantMode()) {
    return globalDir()
  }
  return resolveBrainHomeDiskRoot()
}

/**
 * On-disk "brain home" for **submitting** a new feedback issue: `/.global/` in multi-tenant;
 * in single-tenant, the current request’s brain home (AsyncLocalStorage or env).
 */
export function getCanonicalFeedbackBrainHomeForSubmit(): string {
  if (isMultiTenantMode()) {
    return getGlobalFeedbackBrainHome()
  }
  return tryGetTenantContext()?.homeDir ?? getGlobalFeedbackBrainHome()
}

export async function ensureCanonicalFeedbackLayoutForSubmit(): Promise<void> {
  const base = getCanonicalFeedbackBrainHomeForSubmit()
  await mkdir(brainLayoutIssuesDir(base), { recursive: true })
  await mkdir(brainLayoutVarDir(base), { recursive: true })
}
