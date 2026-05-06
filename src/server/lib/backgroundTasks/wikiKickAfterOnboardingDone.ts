import { getOnboardingMailStatus } from '@server/lib/onboarding/onboardingMailStatus.js'
import {
  markWikiBootstrapSkipped,
  readWikiBootstrapState,
  wikiBootstrapSkipFromEnv,
} from '@server/lib/onboarding/onboardingState.js'
import { WIKI_BUILDOUT_MIN_MESSAGES } from '@shared/onboardingProfileThresholds.js'
import { enqueueWikiBootstrap } from '@server/agent/wikiBootstrapRunner.js'

/**
 * Start Your Wiki supervisor once indexed mail crosses `WIKI_BUILDOUT_MIN_MESSAGES`,
 * after **wiki first-draft bootstrap** completes (OPP-095) or is skipped/failed.
 *
 * Triggered from GET `/api/onboarding/mail`, GET `/api/background-status`, and
 * `notifyOnboardingInterviewDone` (finalize) so the kick runs on poll or immediately after interview.
 */
export async function kickWikiSupervisorIfIndexedGatePasses(): Promise<void> {
  const mail = await getOnboardingMailStatus()
  if (!mail.configured) return
  const indexed = Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0)
  if (indexed < WIKI_BUILDOUT_MIN_MESSAGES) return

  if (wikiBootstrapSkipFromEnv()) {
    const s = await readWikiBootstrapState()
    if (s.status === 'not-started') await markWikiBootstrapSkipped()
    console.log('[wiki/indexed-gate] Starting wiki supervisor (WIKI_BOOTSTRAP_SKIP)')
    const { ensureYourWikiRunning } = await import('@server/agent/yourWikiSupervisor.js')
    void ensureYourWikiRunning().catch((e) =>
      console.error('[wiki/indexed-gate] wiki supervisor start failed:', e),
    )
    return
  }

  let bs = await readWikiBootstrapState()
  if (bs.status === 'not-started') {
    await enqueueWikiBootstrap()
    bs = await readWikiBootstrapState()
  }

  if (bs.status === 'running') {
    console.log('[wiki/bootstrap-gate] Wiki bootstrap in progress — supervisor deferred')
    return
  }

  console.log('[wiki/indexed-gate] Starting wiki supervisor', { indexed, wikiBootstrap: bs.status })
  const { ensureYourWikiRunning } = await import('@server/agent/yourWikiSupervisor.js')
  void ensureYourWikiRunning().catch((e) =>
    console.error('[wiki/indexed-gate] wiki supervisor start failed:', e),
  )
}
