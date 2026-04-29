<script lang="ts">
  import { onMount, tick } from 'svelte'
  import OnboardingWorkspace from './OnboardingWorkspace.svelte'
  import {
    fetchOnboardingMailStatus,
    fetchOnboardingPreferences,
    fetchOnboardingState,
    patchOnboardingState,
    patchOnboardingPreferences,
    postInboxSyncStart,
    postSetupAppleMail,
    postOnboardingFinalize,
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
  import { resizeMainWindowToBrowserLikeWorkArea } from '@client/lib/desktop/browserLikeWindow.js'
  import { isTauriRuntime } from '@client/lib/desktop/isTauriRuntime.js'
  import { ArrowRight } from 'lucide-svelte'
  import VaultSetupStep from './VaultSetupStep.svelte'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'
  import OnboardingHandleStep from './OnboardingHandleStep.svelte'
  interface Props {
    onComplete: () => Promise<void>
    refreshStatus: () => Promise<void>
    /** True when no vault verifier exists yet — first onboarding screen is vault password. */
    needsVaultSetup: boolean
    /** Hosted multi-tenant (BRAIN_DATA_ROOT): profiling uses alternate lead copy. */
    multiTenant?: boolean
  }
  let { onComplete, refreshStatus, needsVaultSetup, multiTenant = false }: Props = $props()

  let state = $state<string>('not-started')
  /** From server; used for indexing-step copy (Apple vs Google). */
  let mailProviderPref = $state<'apple' | 'google' | null>(null)
  /** macOS-only: Apple Mail / Messages / FDA-gated local integrations. */
  let appleLocalIntegrationsAvailable = $state(false)
  let mail = $state<OnboardingMailStatus>(emptyOnboardingMail())
  let setupError = $state<string | null>(null)
  /** PATCH profiling failed while on indexing (e.g. below server minimum). */
  let indexingAdvanceError = $state<string | null>(null)
  /** Finalize after onboarding interview */
  let finalizeError = $state<string | null>(null)
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

  let onboardingExitHandled = $state(false)
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
      return `${d.toLocaleString()} messages indexed`
    }
    return `${d.toLocaleString()} / ${ONBOARDING_PROFILE_INDEX_AUTOPROCEED.toLocaleString()}`
  })
  const indexingProgressAriaText = $derived.by(() => {
    const d = mailIndexedCount
    if (d < 1) return 'Preparing to download messages'
    if (d >= ONBOARDING_PROFILE_INDEX_AUTOPROCEED) {
      return `${d.toLocaleString()} messages indexed, ready to continue`
    }
    return `${d.toLocaleString()} of ${ONBOARDING_PROFILE_INDEX_AUTOPROCEED.toLocaleString()} messages toward continuing`
  })
  const canAutoProceedToInterview = $derived(mailIndexedCount >= ONBOARDING_PROFILE_INDEX_AUTOPROCEED)
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
      return 'We’re downloading your Gmail into Braintunnel so we can build your profile. Hang tight.'
    }
    if (mailProviderPref === 'apple' && appleLocalIntegrationsAvailable) {
      return 'We’re copying your messages from Apple Mail into Braintunnel so we can build your profile. Hang tight.'
    }
    return 'We’re connecting Braintunnel to your email so we can build your profile. Hang tight.'
  })

  const showIndexingHero = $derived(
    !needsVaultSetup &&
      (state === 'indexing' ||
        (state === 'not-started' && mail.configured && !setupError)),
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
    if (needsVaultSetup || setupError) {
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
    if (!shouldRetryProfilingAutoAdvance(mailIndexedCount, interviewAutoAdvanceLastFailedAtCount)) return
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
              `Could not save onboarding progress (${Math.round(ONBOARDING_PATCH_CHAIN_TIMEOUT_MS / 1000)}s timeout). Check the app is responding, then try again.`,
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
            : `Could not resume mail sync${j.error ? ` (${j.error})` : ''}.`
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
                'Sign-in is taking a long time. Use "Open again" or finish sign-in in your browser, then return here.'
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

  let obWorkspace = $state<{ getInterviewSessionId: () => string | null } | null>(null)

  /** Finalize after interview: agent `finish_conversation` (OnboardingWorkspace → AgentChat). Not onStreamFinished — each assistant turn would fire incorrectly. */
  async function continueAfterInterview() {
    finalizeError = null
    busy = true
    await tick()
    try {
      const sessionId = obWorkspace?.getInterviewSessionId() ?? null
      if (!sessionId?.trim()) {
        throw new Error(
          'Send at least one message in the chat above so we can save your session, then try again.',
        )
      }
      await postOnboardingFinalize(sessionId)
      await refreshStatus()
      await load()
      await completeOnboardingToApp()
    } catch (e) {
      finalizeError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function completeOnboardingToApp() {
    if (onboardingExitHandled) return
    onboardingExitHandled = true
    indexingAdvanceError = null
    await onComplete()
  }

</script>

<div
  class="onboarding flex h-full min-h-0 w-full flex-col bg-[var(--bg)] text-[var(--text)]"
  class:onboarding-wide={state !== 'onboarding-agent'}
>
  {#if state === 'onboarding-agent'}
    <div class="flex min-h-0 flex-1 flex-col">
      {#if finalizeError}
        <div
          class="shrink-0 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2"
          role="alert"
        >
          <p class="text-sm text-red-600 dark:text-red-400">{finalizeError}</p>
        </div>
      {/if}
      <OnboardingWorkspace
        bind:this={obWorkspace}
        chatEndpoint="/api/onboarding/interview"
        headerFallbackTitle="Setup"
        storageKey=""
        inputPlaceholder="Type an answer or tap a suggestion above."
        autoSendMessage="Start the guided setup now. Before asking for the user's name: run mail search prioritizing email they sent (from their whoami address, recent window), read a few promising messages for signatures, then open with identity guesses. Continue with important people only; do not configure calendar or inbox rules in this flow. Do not ask them to name you. Do not mention phases, steps, or numbered sections to the user."
        onAgentFinishInterview={() => void continueAfterInterview()}
        {multiTenant}
      />
    </div>
  {:else if multiTenant && state === 'confirming-handle'}
    <OnboardingHandleStep
      refreshStatus={refreshStatus}
      onComplete={async () => {
        await refreshStatus()
        await load()
      }}
    />
  {:else if needsVaultSetup}
    <VaultSetupStep
      {multiTenant}
      onComplete={async () => {
        await refreshStatus()
        await load()
      }}
    />
  {:else}
  <div class="onboarding-main onboarding-main-scroll flex min-h-0 flex-1 flex-col">
    {#if state === 'not-started' && !mailHydrated}
      <OnboardingHeroShell>
        <span class="ob-kicker">Braintunnel</span>
        <p class="ob-lead text-[var(--muted)]" role="status" aria-live="polite">Loading setup…</p>
      </OnboardingHeroShell>
    {:else if state === 'not-started' && !mail.configured}
      <OnboardingHeroShell>
          <span class="ob-kicker">Braintunnel</span>
          {#if multiTenant}
            <h1 class="ob-headline">Your assistant</h1>
            <p class="ob-lead">
              Braintunnel is your assistant for chat, email, and your notes—personalized to you.
              {#if appleLocalIntegrationsAvailable}
                Connect <strong>Apple</strong> or <strong>Google</strong> to connect mail and calendar—then add
                folders later to enrich.
              {:else}
                Connect <strong>Google</strong> to connect mail and calendar—then add folders later to enrich.
              {/if}
            </p>
          {:else if appleLocalIntegrationsAvailable}
            <h1 class="ob-headline">Your assistant, on your Mac</h1>
            <p class="ob-lead">
              Braintunnel is your local assistant for chat, email, and your notes—personalized to you.
              <strong>Mail, Messages, and your files stay on this Mac</strong>—you’re in control. Connect
              <strong>Apple</strong> or <strong>Google</strong> to seed mail and calendar—then add folders later to enrich.
            </p>
          {:else}
            <h1 class="ob-headline">Your assistant</h1>
            <p class="ob-lead">
              Braintunnel is your assistant for chat, email, and your notes—personalized to you. Connect
              <strong>Google</strong> to seed mail and calendar—then add folders later to enrich.
            </p>
          {/if}

          <div class="ob-cta-group">
            {#if setupError}
              <p class="ob-error">{setupError}</p>
            {/if}
            <div class="ob-provider-row" class:ob-provider-row--single={!appleLocalIntegrationsAvailable}>
              {#if appleLocalIntegrationsAvailable}
                <button
                  type="button"
                  class="ob-btn-provider"
                  onclick={() => void setupAppleMail()}
                  disabled={busy}
                >
                  {#if busy}
                    <span class="ob-spinner ob-spinner--provider" aria-hidden="true"></span> Setting up…
                  {:else}
                    Apple
                  {/if}
                </button>
              {/if}
              <button
                type="button"
                class="ob-btn-provider"
                onclick={() => void startGoogleMail()}
                disabled={busy}
              >
                {googleOauthBrowserWait ? 'Open again' : 'Google'}
              </button>
            </div>
            {#if googleOauthBrowserWait}
              <p class="ob-fine-print" role="status" aria-live="polite">
                A browser window should open for Google sign-in (passkeys and 2FA work there). When you are done, return
                to Braintunnel; we will continue automatically. If the tab did not open, use <strong>Open again</strong>.
                {#if !multiTenant}
                  If Safari warns about <code>127.0.0.1</code>, that is your local Braintunnel server over HTTPS.
                {/if}
              </p>
            {/if}
            <p class="ob-fine-print">
              {#if !multiTenant && appleLocalIntegrationsAvailable}
                On Apple, Braintunnel indexes Mail from your library and registers your Mac calendars (same source as
                Calendar.app) for sync. Full Disk Access lets Braintunnel read Mail, Messages, and paths you choose.
              {/if}
              {#if isTauriRuntime()}
                The Braintunnel app opens Google in your default browser for sign-in (mail + calendar read).
              {:else}
                Google sign-in uses this browser (mail + calendar read).
              {/if}
              {#if !multiTenant && appleLocalIntegrationsAvailable}
                macOS may prompt for permissions during setup.
              {/if}
            </p>
          </div>
      </OnboardingHeroShell>

    {:else if state === 'not-started' && mail.configured && setupError}
      <OnboardingHeroShell>
          <span class="ob-kicker">Braintunnel</span>
          <h1 class="ob-headline">Couldn’t start indexing</h1>
          <p class="ob-error">{setupError}</p>
          <div class="ob-cta-group">
            <button
              type="button"
              class="ob-btn-primary"
              onclick={() => void continueToIndexing()}
              disabled={busy}
            >
              {#if busy}
                <span class="ob-spinner" aria-hidden="true"></span> Working…
              {:else}
                Try again
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
            <span class="ob-kicker">Braintunnel</span>
            <h1 class="ob-headline">Getting to Know You.</h1>
            <p class="ob-lead ob-indexing-lead">
              {indexingLeadParagraph}
            </p>
          </div>
          <div class="ob-indexing-status-slot" aria-live="polite">
            {#if !indexingHasFirstMessage}
              <div class="ob-indexing-progress-bar ob-indexing-progress-bar--indeterminate" aria-hidden="true"></div>
            {:else}
              <div
                class="ob-indexing-progress-block ob-indexing-progress-block--determinate"
                role="progressbar"
                aria-label={indexingProgressAriaText}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(indexingProgressPercent)}
              >
                <div class="ob-indexing-progress-bar ob-indexing-progress-bar--determinate" aria-hidden="true">
                  <div
                    class="ob-indexing-progress-fill"
                    style:width="{indexingProgressPercent}%"
                  ></div>
                </div>
                <p class="ob-indexing-progress-fraction" aria-hidden="true">{indexingProgressLabel}</p>
              </div>
            {/if}
            {#if showStaleLockResumeButton}
              <div class="ob-indexing-stale-recover" role="region" aria-label="Mail sync stopped">
                <p class="ob-indexing-calm">A previous mail sync stopped unexpectedly.</p>
                <button
                  type="button"
                  class="ob-btn-primary ob-indexing-stale-btn"
                  onclick={() => void resumeAfterStaleLock()}
                  disabled={busy}
                >
                  {#if busy}
                    <span class="ob-spinner" aria-hidden="true"></span>
                    Resuming…
                  {:else}
                    Resume mail sync
                  {/if}
                </button>
              </div>
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
                      Working…
                    {:else}
                      Try again
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
