<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { t } from '@client/lib/i18n/index.js'
  import {
    fetchOnboardingMailStatus,
    fetchOnboardingPreferences,
    fetchOnboardingState,
    patchOnboardingState,
    patchOnboardingPreferences,
    postInboxSyncStart,
    postSetupAppleMail,
    SETUP_MAIL_ABORT_MESSAGE,
  } from '@client/lib/onboarding/onboardingApi.js'
  import { computeIndexingCalmStatus } from '@client/lib/onboarding/onboardingIndexingUi.js'
  import { shouldKickOnboardingInboxSync } from '@client/lib/onboarding/onboardingInboxSyncKick.js'
  import { shouldRetryProfilingAutoAdvance } from '@client/lib/onboarding/profilingAutoAdvanceRetry.js'
  import {
    ONBOARDING_LARGE_WINDOW_STATES,
    ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
    emptyOnboardingMail,
    type OnboardingMailStatus,
  } from '@client/lib/onboarding/onboardingTypes.js'
  import { isOnboardingInitialMailSyncComplete } from '@shared/onboardingMailGate.js'
  import { resizeMainWindowToBrowserLikeWorkArea } from '@client/lib/desktop/browserLikeWindow.js'
  import { isTauriRuntime } from '@client/lib/desktop/isTauriRuntime.js'
  import { ArrowRight } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'
  import OnboardingHandleStep from './OnboardingHandleStep.svelte'
  interface Props {
    refreshStatus: () => Promise<void>
    /** Hosted multi-tenant: profiling uses alternate lead copy. */
    multiTenant?: boolean
  }
  let { refreshStatus, multiTenant = false }: Props = $props()

  let state = $state<string>('not-started')
  /** From server; used for indexing-step copy (Apple vs Google). */
  let mailProviderPref = $state<'apple' | 'google' | null>(null)
  /** macOS-only: Apple Mail / Messages / FDA-gated local integrations. */
  let appleLocalIntegrationsAvailable = $state(false)
  let mail = $state<OnboardingMailStatus>(emptyOnboardingMail())
  let setupError = $state<string | null>(null)
  /** PATCH profiling failed while on indexing (e.g. below server minimum). */
  let indexingAdvanceError = $state<string | null>(null)
  /** False until first `load()` finishes — avoids showing “Connect Google” while mail status is still default empty. */
  let mailHydrated = $state(false)
  let busy = $state(false)
  /** Tauri: Google OAuth uses the system browser; we wait for the server’s one-shot /last-result. */
  let googleOauthBrowserWait = $state(false)
  let googleOauthPoll: ReturnType<typeof setInterval> | null = null
  const GOOGLE_OAUTH_TAURI_MAX_MS = 10 * 60 * 1000
  const GOOGLE_OAUTH_TAURI_POLL_MS = 1000
  /** If PATCH /status refresh hangs, `busy` would otherwise stay true forever while mail polling still updates the bar. */
  const ONBOARDING_PATCH_CHAIN_TIMEOUT_MS = 60_000

  /** Tauri: true after we’ve applied the “browser-sized” window for late onboarding (interview onward). */
  let onboardingLargeWindowApplied = $state(false)
  const mailIndexedCount = $derived(Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0))
  const indexingHasFirstMessage = $derived(mailIndexedCount >= 1)
  /** Bar tracks progress toward auto-continue, not full mailbox (Ripmail totals often match count). */
  const indexingProgressPercent = $derived.by(() => {
    const d = mailIndexedCount
    if (d < 1) return 0
    return Math.min(100, (100 * d) / ONBOARDING_PROFILE_INDEX_AUTOPROCEED)
  })
  const indexingProgressLabel = $derived.by(() => {
    const d = mailIndexedCount
    if (d < 1) return ''
    if (d >= ONBOARDING_PROFILE_INDEX_AUTOPROCEED) {
      return $t('onboarding.firstRun.indexing.progress.messagesIndexed', { count: d })
    }
    return $t('onboarding.firstRun.indexing.progress.fraction', {
      indexed: d.toLocaleString(),
      target: ONBOARDING_PROFILE_INDEX_AUTOPROCEED.toLocaleString(),
    })
  })
  const indexingProgressAriaText = $derived.by(() => {
    const d = mailIndexedCount
    if (d < 1) return $t('onboarding.firstRun.indexing.aria.preparing')
    if (d >= ONBOARDING_PROFILE_INDEX_AUTOPROCEED) {
      return $t('onboarding.firstRun.indexing.aria.readyToContinue', { count: d })
    }
    return $t('onboarding.firstRun.indexing.aria.towardContinuing', {
      indexed: d.toLocaleString(),
      target: ONBOARDING_PROFILE_INDEX_AUTOPROCEED.toLocaleString(),
    })
  })
  /**
   * Small-inbox path: even when indexed count is below the auto-proceed threshold, advance
   * once the initial mail sync has finished with nothing pending. Otherwise users with tiny
   * mailboxes (a fresh Gmail with a few dozen messages) would be stuck on the indexing hero.
   */
  const initialMailSyncComplete = $derived(isOnboardingInitialMailSyncComplete(mail))
  const canAutoProceedToInterview = $derived(
    mailIndexedCount >= ONBOARDING_PROFILE_INDEX_AUTOPROCEED || initialMailSyncComplete,
  )

  /** Optional reassurance: initial backfill may still run while we advance to interview (does not block). */
  const indexingBackfillFinishingCopy = $derived.by(() => {
    if (
      mailIndexedCount < ONBOARDING_PROFILE_INDEX_AUTOPROCEED ||
      !mail.backfillRunning ||
      mail.staleMailSyncLock ||
      !!mail.indexingHint
    )
      return null
    return $t('onboarding.firstRun.indexing.backfillContinues')
  })
  async function loadMailOnly() {
    const next = await fetchOnboardingMailStatus()
    if (next) mail = next
  }

  /** First load: ensure vault session is refreshed, then retry mail once if the gate returned 401. */
  async function loadMailFirstHydrate() {
    let next = await fetchOnboardingMailStatus()
    if (next === null) {
      await refreshStatus()
      next = await fetchOnboardingMailStatus()
    }
    if (next) mail = next
  }

  async function load() {
    try {
      await refreshStatus()
      const [nextState, pref] = await Promise.all([
        fetchOnboardingState(),
        fetchOnboardingPreferences(),
      ])
      state = nextState
      mailProviderPref = pref.mailProvider
      appleLocalIntegrationsAvailable = pref.appleLocalIntegrationsAvailable
      await loadMailFirstHydrate()
    } finally {
      mailHydrated = true
    }
  }

  onMount(() => {
    void load()
  })

  $effect(() => {
    if (state !== 'not-started' && state !== 'indexing') return
    const t = setInterval(() => {
      void loadMailOnly()
    }, 2000)
    return () => clearInterval(t)
  })

  const indexingLeadParagraph = $derived.by(() => {
    if (mailProviderPref === 'google') {
      return $t('onboarding.firstRun.indexing.lead.google')
    }
    if (mailProviderPref === 'apple' && appleLocalIntegrationsAvailable) {
      return $t('onboarding.firstRun.indexing.lead.apple')
    }
    return $t('onboarding.firstRun.indexing.lead.generic')
  })

  const showIndexingHero = $derived(
    state === 'indexing' || (state === 'not-started' && mail.configured && !setupError),
  )

  const indexingCalmStatus = $derived(
    computeIndexingCalmStatus({ actionableHint: mail.indexingHint }),
  )
  /** Hosted: stale sync lock — show a real button (not “click here” in body copy). */
  const showStaleLockResumeButton = $derived(multiTenant && mail.staleMailSyncLock === true)

  /**
   * Mail can be indexing while onboarding state is still `not-started` (e.g. Apple path + race).
   * `indexing` is required for auto-advance and for PATCH `onboarding-agent` transitions on the server.
   */
  let alignIndexingStateInitiated = $state(false)
  /** Stops a tight loop when PATCH not-started→indexing keeps returning 4xx. */
  let alignIndexingPatchFailed = $state(false)
  $effect(() => {
    if (setupError) {
      alignIndexingStateInitiated = false
      alignIndexingPatchFailed = false
      return
    }
    if (state !== 'not-started') {
      alignIndexingStateInitiated = false
      alignIndexingPatchFailed = false
      return
    }
    if (!mail.configured || busy) {
      alignIndexingStateInitiated = false
      if (!mail.configured) alignIndexingPatchFailed = false
      return
    }
    if (alignIndexingPatchFailed) return
    if (alignIndexingStateInitiated) return
    alignIndexingStateInitiated = true
    void patchState('indexing').catch((e) => {
      alignIndexingStateInitiated = false
      alignIndexingPatchFailed = true
      indexingAdvanceError = e instanceof Error ? e.message : String(e)
    })
  })

  /**
   * Auto-advance to guided onboarding once the mail threshold is met.
   * Handles both `indexing` and stale `not-started` (mail can run before the server state catches up).
   */
  let interviewAutoAdvanceInFlight = $state(false)
  /** Indexed count when auto-advance last got 4xx; retry only after mail progress (or manual continue). */
  let interviewAutoAdvanceLastFailedAtCount = $state<number | null>(null)
  $effect(() => {
    if (state === 'onboarding-agent' || state === 'done') {
      interviewAutoAdvanceLastFailedAtCount = null
    }
  })

  $effect(() => {
    if (!canAutoProceedToInterview || busy || interviewAutoAdvanceInFlight) return
    if (
      !shouldRetryProfilingAutoAdvance(mailIndexedCount, interviewAutoAdvanceLastFailedAtCount)
    )
      return
    const fromNotStarted = state === 'not-started' && mail.configured
    if (state !== 'indexing' && !fromNotStarted) return

    interviewAutoAdvanceInFlight = true
    void (async () => {
      try {
        if (fromNotStarted) {
          await patchState('indexing')
        }
        await patchState('onboarding-agent')
        interviewAutoAdvanceLastFailedAtCount = null
      } catch (e) {
        indexingAdvanceError = e instanceof Error ? e.message : String(e)
        interviewAutoAdvanceLastFailedAtCount = mailIndexedCount
      } finally {
        interviewAutoAdvanceInFlight = false
      }
    })()
  })

  $effect(() => {
    if (!ONBOARDING_LARGE_WINDOW_STATES.has(state)) {
      onboardingLargeWindowApplied = false
      return
    }
    if (onboardingLargeWindowApplied) return
    onboardingLargeWindowApplied = true
    void resizeMainWindowToBrowserLikeWorkArea()
  })

  async function patchState(next: string) {
    const run = async () => {
      await patchOnboardingState(next)
      indexingAdvanceError = null
      await refreshStatus()
      await load()
    }
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              $t('onboarding.firstRun.errors.saveProgressTimeout', {
                seconds: Math.round(ONBOARDING_PATCH_CHAIN_TIMEOUT_MS / 1000),
              }),
            ),
          )
        }, ONBOARDING_PATCH_CHAIN_TIMEOUT_MS)
      }),
    ])
  }

  async function resumeAfterStaleLock() {
    indexingAdvanceError = null
    busy = true
    await tick()
    try {
      const r = await fetch('/api/onboarding/clear-stale-lock', { method: 'POST' })
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string }
        indexingAdvanceError =
          typeof j.message === 'string'
            ? j.message
            : $t('onboarding.firstRun.errors.couldNotResumeMailSync', {
                detail: j.error ? ` (${j.error})` : '',
              })
        return
      }
      await load()
    } catch (e) {
      indexingAdvanceError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  /** Manual retry when auto-advance to guided setup failed (e.g. PATCH error at the indexed threshold). */
  async function proceedToInterviewEarly() {
    indexingAdvanceError = null
    interviewAutoAdvanceLastFailedAtCount = null
    busy = true
    await tick()
    try {
      if (state === 'not-started' && mail.configured) {
        await patchState('indexing')
      }
      await patchState('onboarding-agent')
    } catch (e) {
      indexingAdvanceError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  /** Start background mail sync, then enter indexing (same as post–setup flow). */
  async function continueToIndexing() {
    setupError = null
    busy = true
    await tick()
    try {
      const r = await postInboxSyncStart()
      if (!r.ok) {
        setupError = r.error
        return
      }
      await patchState('indexing')
    } catch (e) {
      setupError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  /**
   * One-shot POST /api/inbox/sync after mail is configured. Runs for `indexing` too so refresh /
   * container / align→indexing does not skip the only sync kick.
   */
  let mailConnectedIndexingAutoStarted = $state(false)
  $effect(() => {
    if (!mail.configured) {
      mailConnectedIndexingAutoStarted = false
    }
  })
  $effect(() => {
    if (
      !shouldKickOnboardingInboxSync({
        state,
        mailConfigured: mail.configured,
        alreadyKicked: mailConnectedIndexingAutoStarted,
      })
    ) {
      return
    }
    mailConnectedIndexingAutoStarted = true
    void continueToIndexing()
  })

  function clearGoogleOauthTauriPoll(): void {
    if (googleOauthPoll) {
      clearInterval(googleOauthPoll)
      googleOauthPoll = null
    }
  }

  $effect(() => {
    if (state !== 'not-started') {
      clearGoogleOauthTauriPoll()
      googleOauthBrowserWait = false
    }
    return () => clearGoogleOauthTauriPoll()
  })

  function googleOauthTauriStartUrl(): string {
    return new URL('/api/oauth/google/start', window.location.origin).href
  }

  async function startGoogleMail() {
    setupError = null
    try {
      await patchOnboardingPreferences('google')
      mailProviderPref = 'google'
    } catch {
      /* non-fatal */
    }
    if (isTauriRuntime()) {
      if (!googleOauthBrowserWait) {
        clearGoogleOauthTauriPoll()
        googleOauthBrowserWait = true
        const startedAt = Date.now()
        googleOauthPoll = setInterval(() => {
          void (async () => {
            if (Date.now() - startedAt > GOOGLE_OAUTH_TAURI_MAX_MS) {
              clearGoogleOauthTauriPoll()
              googleOauthBrowserWait = false
              setupError =
                $t('onboarding.firstRun.errors.googleSignInTakingLong')
              return
            }
            let j: { done: boolean; error: string | null }
            try {
              const r = await fetch('/api/oauth/google/last-result')
              j = (await r.json()) as { done: boolean; error: string | null }
            } catch {
              return
            }
            if (!j.done) return
            clearGoogleOauthTauriPoll()
            googleOauthBrowserWait = false
            if (j.error) {
              setupError = j.error
            } else {
              setupError = null
              await loadMailOnly()
            }
          })()
        }, GOOGLE_OAUTH_TAURI_POLL_MS)
      }
      try {
        const { open } = await import('@tauri-apps/plugin-shell')
        await open(googleOauthTauriStartUrl())
      } catch (e) {
        clearGoogleOauthTauriPoll()
        googleOauthBrowserWait = false
        setupError = e instanceof Error ? e.message : String(e)
      }
      return
    }
    window.location.href = '/api/oauth/google/start'
  }

  async function setupAppleMail() {
    setupError = null
    busy = true
    await tick()
    try {
      await patchOnboardingPreferences('apple')
      mailProviderPref = 'apple'
      const r = await postSetupAppleMail()
      if (!r.ok) {
        setupError = r.error
        return
      }
      await patchState('indexing')
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setupError = SETUP_MAIL_ABORT_MESSAGE
      } else {
        setupError = e instanceof Error ? e.message : String(e)
      }
    } finally {
      busy = false
    }
  }

</script>

<div
  class={cn(
    'onboarding flex min-h-0 w-full flex-1 flex-col bg-[var(--bg)] text-[var(--text)]',
    state !== 'onboarding-agent' && 'onboarding-wide',
  )}
>
  {#if state === 'onboarding-agent'}
    <div
      class="rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-muted"
      role="status"
    >
      {$t('onboarding.firstRun.guidedSetup.continuesPrefix')}
      <strong class="text-foreground">{$t('onboarding.firstRun.guidedSetup.chatLabel')}</strong>
      {$t('onboarding.firstRun.guidedSetup.continuesSuffix')}
    </div>
  {:else if state === 'confirming-handle'}
    <OnboardingHandleStep
      {refreshStatus}
      onComplete={async () => {
        await refreshStatus()
        await load()
      }}
    />
  {:else}
    <div class="onboarding-main onboarding-main-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
      {#if state === 'not-started' && !mailHydrated}
        <OnboardingHeroShell>
          <span class="ob-kicker">{$t('onboarding.firstRun.kicker')}</span>
          <p class="ob-lead text-[var(--muted)]" role="status" aria-live="polite">
            {$t('onboarding.firstRun.loadingSetup')}
          </p>
        </OnboardingHeroShell>
      {:else if state === 'not-started' && !mail.configured}
        <OnboardingHeroShell>
          <span class="ob-kicker">{$t('onboarding.firstRun.kicker')}</span>
          {#if multiTenant}
            <h1 class="ob-headline">{$t('onboarding.firstRun.intro.multiTenant.title')}</h1>
            <p class="ob-lead">
              {$t('onboarding.firstRun.intro.multiTenant.leadPrefix')}
              {#if appleLocalIntegrationsAvailable}
                {$t('onboarding.firstRun.intro.multiTenant.appleAvailable.beforeStrong')}
                <strong>{$t('onboarding.firstRun.providers.apple')}</strong>
                {$t('onboarding.firstRun.intro.multiTenant.appleAvailable.middleStrong')}
                <strong>{$t('onboarding.firstRun.providers.google')}</strong>
                {$t('onboarding.firstRun.intro.multiTenant.appleAvailable.afterStrong')}
              {:else}
                {$t('onboarding.firstRun.intro.multiTenant.googleOnly.beforeStrong')}
                <strong>{$t('onboarding.firstRun.providers.google')}</strong>
                {$t('onboarding.firstRun.intro.multiTenant.googleOnly.afterStrong')}
              {/if}
            </p>
          {:else if appleLocalIntegrationsAvailable}
            <h1 class="ob-headline">{$t('onboarding.firstRun.intro.desktop.title')}</h1>
            <p class="ob-lead">
              {$t('onboarding.firstRun.intro.desktop.lead.beforeStrong')}
              <strong>{$t('onboarding.firstRun.intro.desktop.lead.strong')}</strong>
              {$t('onboarding.firstRun.intro.desktop.lead.afterStrongPrefix')}
              <strong>{$t('onboarding.firstRun.providers.apple')}</strong>
              {$t('onboarding.firstRun.intro.desktop.lead.middleStrong')}
              <strong>{$t('onboarding.firstRun.providers.google')}</strong>
              {$t('onboarding.firstRun.intro.desktop.lead.afterStrongSuffix')}
            </p>
          {:else}
            <h1 class="ob-headline">{$t('onboarding.firstRun.intro.googleOnly.title')}</h1>
            <p class="ob-lead">
              {$t('onboarding.firstRun.intro.googleOnly.lead.beforeStrong')}
              <strong>{$t('onboarding.firstRun.providers.google')}</strong>
              {$t('onboarding.firstRun.intro.googleOnly.lead.afterStrong')}
            </p>
          {/if}

          <div class="ob-cta-group">
            {#if setupError}
              <p class="ob-error">{setupError}</p>
            {/if}
            <div
              class={cn(
                'ob-provider-row',
                !appleLocalIntegrationsAvailable && 'ob-provider-row--single',
              )}
            >
              {#if appleLocalIntegrationsAvailable}
                <button
                  type="button"
                  class="ob-btn-provider"
                  onclick={() => void setupAppleMail()}
                  disabled={busy}
                >
                  {#if busy}
                    <span class="ob-spinner ob-spinner--provider" aria-hidden="true"></span>
                    {$t('onboarding.firstRun.settingUp')}
                  {:else}
                    {$t('onboarding.firstRun.providers.apple')}
                  {/if}
                </button>
              {/if}
              <button
                type="button"
                class="ob-btn-provider"
                onclick={() => void startGoogleMail()}
                disabled={busy}
              >
                {googleOauthBrowserWait
                  ? $t('onboarding.firstRun.openAgain')
                  : $t('onboarding.firstRun.providers.google')}
              </button>
            </div>
            {#if googleOauthBrowserWait}
              <p class="ob-fine-print" role="status" aria-live="polite">
                {$t('onboarding.firstRun.googleOauthWait.copyPrefix')}
                <strong>{$t('onboarding.firstRun.openAgain')}</strong>.
                {#if !multiTenant}
                  {$t('onboarding.firstRun.googleOauthWait.localSafariWarningPrefix')}
                  <code>127.0.0.1</code>
                  {$t('onboarding.firstRun.googleOauthWait.localSafariWarningSuffix')}
                {/if}
              </p>
            {/if}
            <p class="ob-fine-print">
              {#if !multiTenant && appleLocalIntegrationsAvailable}
                {$t('onboarding.firstRun.providerNotes.appleDesktop')}
              {/if}
              {#if isTauriRuntime()}
                {$t('onboarding.firstRun.providerNotes.googleTauri')}
              {:else}
                {$t('onboarding.firstRun.providerNotes.googleBrowser')}
              {/if}
              {#if !multiTenant && appleLocalIntegrationsAvailable}
                {$t('onboarding.firstRun.providerNotes.applePermissions')}
              {/if}
            </p>
          </div>
        </OnboardingHeroShell>
      {:else if state === 'not-started' && mail.configured && setupError}
        <OnboardingHeroShell>
          <span class="ob-kicker">{$t('onboarding.firstRun.kicker')}</span>
          <h1 class="ob-headline">{$t('onboarding.firstRun.couldNotStartIndexingTitle')}</h1>
          <p class="ob-error">{setupError}</p>
          <div class="ob-cta-group">
            <button
              type="button"
              class="ob-btn-primary"
              onclick={() => void continueToIndexing()}
              disabled={busy}
            >
              {#if busy}
                <span class="ob-spinner" aria-hidden="true"></span>
                {$t('onboarding.common.working')}
              {:else}
                {$t('onboarding.common.tryAgain')}
                <ArrowRight class="ob-btn-icon" size={16} strokeWidth={2} aria-hidden="true" />
              {/if}
            </button>
          </div>
        </OnboardingHeroShell>
      {:else if showIndexingHero}
        <OnboardingHeroShell indexing ariaBusy="true">
          <div class="ob-indexing-fixed">
            <div class="ob-indexing-visual" aria-hidden="true">
              <span class="ob-indexing-orbit"></span>
              <span class="ob-indexing-orbit ob-indexing-orbit-delayed"></span>
              <span class="ob-indexing-core"></span>
            </div>
            <span class="ob-kicker">{$t('onboarding.firstRun.kicker')}</span>
            <h1 class="ob-headline">{$t('onboarding.firstRun.indexing.title')}</h1>
            <p class="ob-lead ob-indexing-lead">
              {indexingLeadParagraph}
            </p>
          </div>
          <div class="ob-indexing-status-slot" aria-live="polite">
            {#if !indexingHasFirstMessage}
              <div
                class="ob-indexing-progress-bar ob-indexing-progress-bar--indeterminate"
                aria-hidden="true"
              ></div>
            {:else}
              <div
                class="ob-indexing-progress-block ob-indexing-progress-block--determinate"
                role="progressbar"
                aria-label={indexingProgressAriaText}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(indexingProgressPercent)}
              >
                <div
                  class="ob-indexing-progress-bar ob-indexing-progress-bar--determinate"
                  aria-hidden="true"
                >
                  <div
                    class="ob-indexing-progress-fill"
                    style:width="{indexingProgressPercent}%"
                  ></div>
                </div>
                <p class="ob-indexing-progress-fraction" aria-hidden="true">
                  {indexingProgressLabel}
                </p>
              </div>
            {/if}
            {#if showStaleLockResumeButton}
              <div
                class="ob-indexing-stale-recover"
                role="region"
                aria-label={$t('onboarding.firstRun.indexing.staleLock.ariaLabel')}
              >
                <p class="ob-indexing-calm">
                  {$t('onboarding.firstRun.indexing.staleLock.stoppedUnexpectedly')}
                </p>
                <button
                  type="button"
                  class="ob-btn-primary ob-indexing-stale-btn"
                  onclick={() => void resumeAfterStaleLock()}
                  disabled={busy}
                >
                  {#if busy}
                    <span class="ob-spinner" aria-hidden="true"></span>
                    {$t('onboarding.firstRun.indexing.staleLock.resuming')}
                  {:else}
                    {$t('onboarding.firstRun.indexing.staleLock.resumeButton')}
                  {/if}
                </button>
              </div>
            {:else if indexingBackfillFinishingCopy}
              <p class="ob-indexing-calm">{indexingBackfillFinishingCopy}</p>
            {:else if indexingCalmStatus}
              <p class="ob-indexing-calm">{indexingCalmStatus}</p>
            {/if}
            {#if indexingAdvanceError}
              <div class="ob-indexing-advance-error" role="alert">
                <p class="ob-error ob-indexing-mail-error">{indexingAdvanceError}</p>
                {#if canAutoProceedToInterview && (state === 'indexing' || (state === 'not-started' && mail.configured))}
                  <button
                    type="button"
                    class="ob-btn-primary ob-indexing-advance-retry-btn"
                    onclick={() => void proceedToInterviewEarly()}
                    disabled={busy}
                  >
                    {#if busy}
                      <span class="ob-spinner" aria-hidden="true"></span>
                      {$t('onboarding.common.working')}
                    {:else}
                      {$t('onboarding.common.tryAgain')}
                    {/if}
                  </button>
                {/if}
              </div>
            {/if}
            {#if mail.statusError}
              <p class="ob-error ob-indexing-mail-error">{mail.statusError}</p>
            {/if}
          </div>
        </OnboardingHeroShell>
      {/if}
    </div>
  {/if}
</div>
