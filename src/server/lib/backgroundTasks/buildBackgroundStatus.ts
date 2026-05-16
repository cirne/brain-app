import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'
import type { BackgroundRunDoc } from '@server/lib/chat/backgroundAgentStore.js'
import type { OnboardingMailStatusPayload } from '@server/lib/onboarding/onboardingMailStatus.js'
import type { OnboardingMachineState } from '@server/lib/onboarding/onboardingState.js'
import { ONBOARDING_PROFILE_INDEX_MANUAL_MIN } from '@shared/onboardingProfileThresholds.js'
import {
  mailIndexMeetsWikiSupervisorHistoryMinimum,
  wikiSupervisorMailPreflightPasses,
} from '@shared/wikiMailIndexedHistoryGate.js'
import { listRecentFailedOrchestratorTasks } from './orchestrator.js'

/** Hub hint while TS Gmail historical lane (`sync_summary` id=2) is active — onboarding uses a single ~1y slice from indexing onward. */
export function inferBackfillPhase(
  _state: OnboardingMachineState,
  backfillRunning: boolean,
): '30d' | '1y' | null {
  if (!backfillRunning) return null
  return '1y'
}

function wikiRollupStatus(doc: BackgroundRunDoc): BackgroundStatusResponse['wiki']['status'] {
  const ph = doc.phase ?? 'idle'
  if (doc.status === 'error' || ph === 'error') return 'error'
  if (doc.status === 'paused' || ph === 'paused') return 'paused'
  if (doc.status === 'running' || ph === 'starting' || ph === 'surveying' || ph === 'enriching' || ph === 'cleaning') {
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

  const interviewReady =
    indexed >= ONBOARDING_PROFILE_INDEX_MANUAL_MIN && mail.configured

  const phase1Complete =
    state === 'onboarding-agent' ||
    state === 'done' ||
    (mail.configured && indexed >= ONBOARDING_PROFILE_INDEX_MANUAL_MIN && !mail.backfillRunning)

  const phase2Complete =
    state === 'done' && mail.configured && !mail.backfillRunning && indexed > 0

  const indexedHistoryDepthOk = mailIndexMeetsWikiSupervisorHistoryMinimum(mail.dateRange)
  const wikiSupervisorPreflightOk = wikiSupervisorMailPreflightPasses(mail)

  const milestones = {
    interviewReady,
    wikiReady: state === 'done' && wikiSupervisorPreflightOk,
    fullySynced:
      state === 'done' &&
      mail.configured &&
      !mail.backfillRunning &&
      !mail.syncRunning &&
      !(mail.deepHistoricalPending ?? false),
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
      backfillListedTarget: mail.backfillListedTarget ?? null,
      configured: mail.configured,
      dateRange: mail.dateRange,
      indexedHistoryDepthOk,
      phase1Complete,
      phase2Complete,
      syncRunning: mail.syncRunning,
      backfillRunning: mail.backfillRunning,
      backfillPhase: inferBackfillPhase(state, mail.backfillRunning),
      refreshRunning: mail.refreshRunning,
      lastSyncedAt: mail.lastSyncedAt,
      syncLockAgeMs: mail.syncLockAgeMs,
      pendingBackfill: mail.pendingBackfill,
      deepHistoricalPending: mail.deepHistoricalPending ?? false,
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
      autoStartEligible: wikiSupervisorPreflightOk,
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
