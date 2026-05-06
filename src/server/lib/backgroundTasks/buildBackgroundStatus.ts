import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'
import type { BackgroundRunDoc } from '@server/lib/chat/backgroundAgentStore.js'
import type { OnboardingMailStatusPayload } from '@server/lib/onboarding/onboardingMailStatus.js'
import type { OnboardingMachineState } from '@server/lib/onboarding/onboardingState.js'
import { readWikiBootstrapState } from '@server/lib/onboarding/onboardingState.js'
import {
  ONBOARDING_PROFILE_INDEX_MANUAL_MIN,
  WIKI_BUILDOUT_MIN_MESSAGES,
} from '@shared/onboardingProfileThresholds.js'
import { listRecentFailedOrchestratorTasks } from './orchestrator.js'

export function inferBackfillPhase(
  state: OnboardingMachineState,
  backfillRunning: boolean,
): '30d' | '1y' | null {
  if (!backfillRunning) return null
  if (state === 'indexing' || state === 'not-started') return '30d'
  return '1y'
}

function wikiRollupStatus(doc: BackgroundRunDoc): BackgroundStatusResponse['wiki']['status'] {
  const ph = doc.phase ?? 'idle'
  if (doc.status === 'error' || ph === 'error') return 'error'
  if (doc.status === 'paused' || ph === 'paused') return 'paused'
  if (doc.status === 'running' || ph === 'starting' || ph === 'enriching' || ph === 'cleaning') {
    return 'running'
  }
  if (doc.status === 'queued') return 'queued'
  return 'idle'
}

export async function buildBackgroundStatusPayload(input: {
  mail: OnboardingMailStatusPayload
  state: OnboardingMachineState
  wikiMeExists: boolean
  wikiDoc: BackgroundRunDoc
  onboardingFlowActive: boolean
}): Promise<BackgroundStatusResponse> {
  const { mail, state, wikiMeExists, wikiDoc, onboardingFlowActive } = input
  const indexed = Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)
  const wikiBootstrapDoc = await readWikiBootstrapState()

  const interviewReady =
    indexed >= ONBOARDING_PROFILE_INDEX_MANUAL_MIN && mail.configured

  const phase1Complete =
    state === 'onboarding-agent' ||
    state === 'done' ||
    (mail.configured && indexed >= ONBOARDING_PROFILE_INDEX_MANUAL_MIN && !mail.backfillRunning)

  const phase2Complete =
    state === 'done' && mail.configured && !mail.backfillRunning && indexed > 0

  const wikiBootstrapGatePassed =
    wikiBootstrapDoc.status === 'completed' || wikiBootstrapDoc.status === 'failed'

  const milestones = {
    interviewReady,
    wikiReady:
      state === 'done' &&
      indexed >= WIKI_BUILDOUT_MIN_MESSAGES &&
      wikiBootstrapGatePassed,
    fullySynced: state === 'done' && mail.configured && !mail.backfillRunning && !mail.syncRunning,
  }

  const failures = await listRecentFailedOrchestratorTasks(8)

  const phase = (wikiDoc.phase ?? 'idle') as BackgroundStatusResponse['wiki']['phase']

  return {
    updatedAt: new Date().toISOString(),
    onboardingFlowActive,
    mail: {
      indexedTotal: indexed,
      ftsReady: mail.ftsReady,
      messageAvailableForProgress: mail.messageAvailableForProgress,
      configured: mail.configured,
      dateRange: mail.dateRange,
      phase1Complete,
      phase2Complete,
      syncRunning: mail.syncRunning,
      backfillRunning: mail.backfillRunning,
      backfillPhase: inferBackfillPhase(state, mail.backfillRunning),
      refreshRunning: mail.refreshRunning,
      lastSyncedAt: mail.lastSyncedAt,
      syncLockAgeMs: mail.syncLockAgeMs,
      pendingBackfill: mail.pendingBackfill,
      staleMailSyncLock: mail.staleMailSyncLock,
      indexingHint: mail.indexingHint,
      statusError: mail.statusError,
    },
    wiki: {
      status: wikiRollupStatus(wikiDoc),
      phase,
      pageCount: wikiDoc.pageCount ?? 0,
      currentLap: wikiDoc.lap ?? 0,
      detail: wikiDoc.detail ?? '',
      lastRunAt: wikiDoc.updatedAt ?? null,
      autoStartEligible:
        mail.configured &&
        indexed >= WIKI_BUILDOUT_MIN_MESSAGES &&
        wikiBootstrapGatePassed,
      bootstrap: {
        status: wikiBootstrapDoc.status,
        completedAt: wikiBootstrapDoc.completedAt ?? null,
        ...(wikiBootstrapDoc.skipped === true ? { skipped: true } : {}),
        ...(wikiBootstrapDoc.stats ? { stats: wikiBootstrapDoc.stats } : {}),
        ...(wikiBootstrapDoc.lastError ? { lastError: wikiBootstrapDoc.lastError } : {}),
      },
      lapMailSyncStale: wikiDoc.lapMailSyncIncomplete === true,
      error: wikiDoc.error,
    },
    onboarding: {
      state,
      wikiMeExists,
      milestones,
    },
    orchestrator:
      failures.length > 0
        ? {
            recentFailures: failures.map((t) => ({
              id: t.id,
              type: t.type,
              status: t.status,
              lastError: t.lastError,
              completedAt: t.completedAt,
              createdAt: t.createdAt,
            })),
          }
        : undefined,
  }
}
