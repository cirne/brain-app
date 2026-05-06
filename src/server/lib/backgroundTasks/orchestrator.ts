import { appendTask, readTaskQueue, type BackgroundTaskRecord } from './taskQueue.js'
import { kickWikiSupervisorIfIndexedGatePasses } from './wikiKickAfterOnboardingDone.js'

/** Hook: onboarding interview finalized → ensure wiki kick (idempotent if threshold already ran supervisor). */
export async function notifyOnboardingInterviewDone(): Promise<void> {
  await kickWikiSupervisorIfIndexedGatePasses()
}

/** Persist outer-loop supervisor failures for unified status / debugging. */
export async function recordWikiSupervisorOuterLoopFailure(message: string): Promise<void> {
  const trimmed = message.trim().slice(0, 2000)
  await appendTask({
    id: crypto.randomUUID(),
    type: 'wiki-lap',
    status: 'failed',
    priority: 0,
    retries: 0,
    maxRetries: 3,
    lastError: trimmed || '(unknown)',
    completedAt: new Date().toISOString(),
  })
}

/** Persist wiki first-draft bootstrap failures (OPP-095) for unified status / debugging. */
export async function recordWikiBootstrapFailure(message: string): Promise<void> {
  const trimmed = message.trim().slice(0, 2000)
  await appendTask({
    id: crypto.randomUUID(),
    type: 'wiki-bootstrap',
    status: 'failed',
    priority: 0,
    retries: 0,
    maxRetries: 0,
    lastError: trimmed || '(unknown)',
    completedAt: new Date().toISOString(),
  })
}

/** Recent failed orchestrator records (newest last). */
export async function listRecentFailedOrchestratorTasks(limit = 8): Promise<BackgroundTaskRecord[]> {
  const tasks = await readTaskQueue()
  return tasks.filter((t) => t.status === 'failed').slice(-limit)
}
