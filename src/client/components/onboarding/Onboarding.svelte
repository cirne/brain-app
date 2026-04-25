<script lang="ts">
  import { onMount, tick } from 'svelte'
  import OnboardingWorkspace from './OnboardingWorkspace.svelte'
  import ProfileDraftEditor from './ProfileDraftEditor.svelte'
  import {
    fetchOnboardingMailStatus,
    fetchOnboardingPreferences,
    fetchOnboardingState,
    patchOnboardingState,
    patchOnboardingPreferences,
    postAcceptProfile,
    postInboxSyncStart,
    postSetupAppleMail,
    fetchProfileDraftMarkdown,
    SETUP_MAIL_ABORT_MESSAGE,
  } from '@client/lib/onboarding/onboardingApi.js'
  import { computeIndexingCalmStatus } from '@client/lib/onboarding/onboardingIndexingUi.js'
  import {
    ONBOARDING_LARGE_WINDOW_STATES,
    ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
    ONBOARDING_PROFILE_INDEX_MANUAL_MIN,
    emptyOnboardingMail,
    type OnboardingMailStatus,
  } from '@client/lib/onboarding/onboardingTypes.js'
  import { resizeMainWindowToBrowserLikeWorkArea } from '@client/lib/desktop/browserLikeWindow.js'
  import VaultSetupStep from './VaultSetupStep.svelte'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'
  import OnboardingHandleStep from './OnboardingHandleStep.svelte'
  import OnboardingSeedingInterstitial from './OnboardingSeedingInterstitial.svelte'

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
  /** Review / accept-profile */
  let profileStepError = $state<string | null>(null)
  let busy = $state(false)
  /** Tauri: Google OAuth uses the system browser; we wait for the server’s one-shot /last-result. */
  let googleOauthBrowserWait = $state(false)
  let googleOauthPoll: ReturnType<typeof setInterval> | null = null
  const GOOGLE_OAUTH_TAURI_MAX_MS = 10 * 60 * 1000
  const GOOGLE_OAUTH_TAURI_POLL_MS = 1000
  /** If PATCH /status refresh hangs, `busy` would otherwise stay true forever while mail polling still updates the bar. */
  const ONBOARDING_PATCH_CHAIN_TIMEOUT_MS = 60_000

  let draftMarkdown = $state('')
  /** Bump to remount {@link ProfileDraftEditor} after reload-from-disk (discards unsaved TipTap edits). */
  let draftEditorKey = $state(0)
  let profileDraftEditor = $state<{ flushSave: () => Promise<void> } | null>(null)
  let categoriesText = $state('People\nProjects\nInterests\nAreas')

  let onboardingExitHandled = $state(false)
  /** Tauri: true after we’ve applied the “browser-sized” window for late onboarding (profiling onward). */
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
  const canAutoProceedToProfiling = $derived(mailIndexedCount >= ONBOARDING_PROFILE_INDEX_AUTOPROCEED)
  const canOfferEarlyProfile = $derived(
    mailIndexedCount >= ONBOARDING_PROFILE_INDEX_MANUAL_MIN &&
      mailIndexedCount < ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
  )
  async function loadMailOnly() {
    const next = await fetchOnboardingMailStatus()
    if (next) mail = next
  }

  async function load() {
    const [nextState, pref] = await Promise.all([
      fetchOnboardingState(),
      fetchOnboardingPreferences(),
    ])
    state = nextState
    mailProviderPref = pref.mailProvider
    appleLocalIntegrationsAvailable = pref.appleLocalIntegrationsAvailable
    await loadMailOnly()
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

  /**
   * Mail can be indexing while onboarding state is still `not-started` (e.g. Apple path + race).
   * `indexing` is required for auto-advance and for PATCH `profiling` transitions on the server.
   */
  let alignIndexingStateInitiated = $state(false)
  $effect(() => {
    if (needsVaultSetup || setupError) {
      alignIndexingStateInitiated = false
      return
    }
    if (state !== 'not-started') {
      alignIndexingStateInitiated = false
      return
    }
    if (!mail.configured || busy) {
      alignIndexingStateInitiated = false
      return
    }
    if (alignIndexingStateInitiated) return
    alignIndexingStateInitiated = true
    void patchState('indexing').catch((e) => {
      alignIndexingStateInitiated = false
      indexingAdvanceError = e instanceof Error ? e.message : String(e)
    })
  })

  /**
   * Auto-advance to profiling once the mail threshold is met.
   * Handles both `indexing` and stale `not-started` (mail can run before the server state catches up).
   */
  let profilingAutoAdvanceInFlight = $state(false)

  $effect(() => {
    if (!canAutoProceedToProfiling || busy || profilingAutoAdvanceInFlight) return
    const fromNotStarted = state === 'not-started' && mail.configured
    if (state !== 'indexing' && !fromNotStarted) return

    profilingAutoAdvanceInFlight = true
    void (async () => {
      try {
        if (fromNotStarted) {
          await patchState('indexing')
        }
        await patchState('profiling')
      } catch (e) {
        indexingAdvanceError = e instanceof Error ? e.message : String(e)
      } finally {
        profilingAutoAdvanceInFlight = false
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

  async function proceedToProfilingEarly() {
    indexingAdvanceError = null
    busy = true
    await tick()
    try {
      if (state === 'not-started' && mail.configured) {
        await patchState('indexing')
      }
      await patchState('profiling')
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

  /** Mail already configured + not-started: start sync once (no Continue interstitial). */
  let mailConnectedIndexingAutoStarted = $state(false)
  $effect(() => {
    if (state !== 'not-started') mailConnectedIndexingAutoStarted = false
  })
  $effect(() => {
    if (state !== 'not-started' || !mail.configured || mailConnectedIndexingAutoStarted) return
    mailConnectedIndexingAutoStarted = true
    void continueToIndexing()
  })

  function isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  }

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

  async function loadDraft() {
    const md = await fetchProfileDraftMarkdown()
    if (md != null) draftMarkdown = md
  }

  async function clearProfilingChatSession() {
    try {
      await fetch('/api/onboarding/profiling-sessions', { method: 'DELETE' })
    } catch {
      /* ignore */
    }
  }

  async function reloadProfileDraftFromDisk() {
    if (
      !confirm(
        'Reload the profile text from disk? Any edits you have not saved yet will be replaced.',
      )
    ) {
      return
    }
    profileStepError = null
    busy = true
    await tick()
    try {
      const md = await fetchProfileDraftMarkdown()
      if (md == null) {
        profileStepError = 'Could not load profile draft.'
        return
      }
      draftMarkdown = md
      draftEditorKey += 1
    } catch (e) {
      profileStepError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function goBackToProfiling() {
    if (
      !confirm(
        'Go back to profiling to run the profile step again? You will leave this screen and unsaved edits here will be lost.',
      )
    ) {
      return
    }
    profileStepError = null
    busy = true
    await tick()
    try {
      await clearProfilingChatSession()
      await patchState('profiling')
    } catch (e) {
      profileStepError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function acceptProfile() {
    profileStepError = null
    try {
      await profileDraftEditor?.flushSave()
    } catch {
      /* flushSave ignores persist errors; continue */
    }
    busy = true
    try {
      const categories = categoriesText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      await postAcceptProfile(categories)
      await refreshStatus()
      const nextAfterAccept = await fetchOnboardingState()
      state = nextAfterAccept
      await loadMailOnly()
      if (nextAfterAccept === 'seeding') {
        return
      }
      await finishOnboarding()
    } catch (e) {
      profileStepError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function finishOnboarding() {
    if (onboardingExitHandled) return
    onboardingExitHandled = true
    await patchOnboardingState('done')
    indexingAdvanceError = null
    await onComplete()
  }

  $effect(() => {
    if (state === 'reviewing-profile') void loadDraft()
  })

</script>

<div
  class="onboarding flex h-full min-h-0 w-full flex-col bg-[var(--bg)] text-[var(--text)]"
  class:onboarding-wide={state !== 'profiling' && state !== 'reviewing-profile' && state !== 'seeding'}
>
  {#if state === 'profiling'}
    <OnboardingWorkspace
      chatEndpoint="/api/onboarding/profile"
      headerFallbackTitle="Profiling"
      storageKey=""
        autoSendMessage="From my indexed email, write wiki root me.md for the main assistant. Use the tools; ground claims in whoami and mail. Follow the system contract: clear ## sections, Key people as a bullet list (one person per line), blank lines between sections. Interests, CRM-style detail, and long bios belong in the wiki after onboarding, not in me.md."
      onStreamFinished={async () => { await patchState('reviewing-profile') }}
      {multiTenant}
    />
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
  <div
    class="onboarding-main flex min-h-0 flex-1 flex-col"
    class:onboarding-main-scroll={state !== 'reviewing-profile' && state !== 'seeding'}
    class:onboarding-main-review={state === 'reviewing-profile'}
    class:onboarding-main-seed={state === 'seeding'}
  >
    {#if state === 'not-started' && !mail.configured}
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
                <svg class="ob-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
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
            {#if indexingCalmStatus}
              <p class="ob-indexing-calm">{indexingCalmStatus}</p>
            {/if}
            {#if showIndexingHero && (canOfferEarlyProfile || canAutoProceedToProfiling) && (state === 'indexing' || (state === 'not-started' && mail.configured))}
              <div class="ob-indexing-early" role="region" aria-label="Continue to profile building">
                {#if canOfferEarlyProfile}
                  <p class="ob-indexing-early-copy">
                    You’ve got enough mail for a strong first profile. We’ll keep downloading the rest in the background
                    while you talk with Braintunnel.
                  </p>
                {/if}
                <button
                  type="button"
                  class="ob-btn-primary ob-indexing-early-btn"
                  onclick={() => void proceedToProfilingEarly()}
                  disabled={busy}
                >
                  {#if busy}
                    <span class="ob-spinner" aria-hidden="true"></span>
                    Working…
                  {:else}
                    {canAutoProceedToProfiling ? 'Continue to profile' : 'Build my profile now'}
                  {/if}
                </button>
              </div>
            {/if}
            {#if indexingAdvanceError}
              <p class="ob-error ob-indexing-mail-error" role="alert">{indexingAdvanceError}</p>
            {/if}
            {#if mail.statusError}
              <p class="ob-error ob-indexing-mail-error">{mail.statusError}</p>
            {/if}
          </div>
      </OnboardingHeroShell>

    {:else if state === 'seeding'}
      <OnboardingSeedingInterstitial
        onContinue={async () => {
          profileStepError = null
          busy = true
          try {
            await finishOnboarding()
          } catch (e) {
            profileStepError = e instanceof Error ? e.message : String(e)
          } finally {
            busy = false
          }
        }}
        continueBusy={busy}
        errorText={profileStepError}
        {multiTenant}
      />

    {:else if state === 'reviewing-profile'}
      <section class="ob-review" aria-labelledby="ob-review-title">
        <div class="ob-review-top">
          <header class="ob-review-header">
            <h2 id="ob-review-title" class="ob-review-title">Review your profile</h2>
            <p class="ob-review-lead">
              Your assistant uses this to stay current on projects, contacts, and interests. Edit anything below, then continue.
            </p>
          </header>
          {#if profileStepError}
            <p class="ob-error ob-review-error" role="alert">{profileStepError}</p>
          {/if}
        </div>
        <div class="ob-review-editor">
          {#key draftEditorKey}
            <ProfileDraftEditor
              bind:this={profileDraftEditor}
              initialMarkdown={draftMarkdown}
              disabled={busy}
            />
          {/key}
        </div>
        <footer class="ob-review-footer">
          <div class="ob-review-actions" role="group" aria-label="Profile actions">
            <div class="ob-review-secondary" role="group" aria-label="Profile draft options">
              <button
                type="button"
                class="ob-btn-secondary ob-review-secondary-btn"
                onclick={() => void reloadProfileDraftFromDisk()}
                disabled={busy}
              >
                Reset
              </button>
              <button
                type="button"
                class="ob-btn-secondary ob-review-secondary-btn"
                onclick={() => void goBackToProfiling()}
                disabled={busy}
              >
                Retry
              </button>
            </div>
            <button type="button" class="ob-btn-primary ob-review-cta" onclick={() => void acceptProfile()} disabled={busy}>
              <span>{busy ? 'Saving…' : 'Looks Good'}</span>
              <svg class="ob-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </div>
        </footer>
      </section>

    {/if}
  </div>
  {/if}
</div>
