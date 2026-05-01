import { mkdir } from 'node:fs/promises'
import { globalDir } from '@server/lib/tenant/dataRoot.js'
import { brainLayoutIssuesDir, brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'

/** On-disk root for list/fetch with embed key (global queue under `BRAIN_DATA_ROOT/.global`). */
export function getGlobalFeedbackBrainHome(): string {
  return globalDir()
}

/** On-disk root for submitting a new feedback issue. */
export function getCanonicalFeedbackBrainHomeForSubmit(): string {
  return getGlobalFeedbackBrainHome()
}

export async function ensureCanonicalFeedbackLayoutForSubmit(): Promise<void> {
  const base = getCanonicalFeedbackBrainHomeForSubmit()
  await mkdir(brainLayoutIssuesDir(base), { recursive: true })
  await mkdir(brainLayoutVarDir(base), { recursive: true })
}
