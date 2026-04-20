<script lang="ts">
  import { onMount, tick } from 'svelte'
  /** Hero typography + CTAs used by hero shell and by review/profile steps outside the shell. */
  import './onboardingHeroPrimitives.css'
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
  } from './onboardingApi.js'
  import { buildIndexingElapsedLine } from './onboardingIndexingUi.js'
  import {
    ONBOARDING_LARGE_WINDOW_STATES,
    ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
    ONBOARDING_PROFILE_INDEX_MANUAL_MIN,
    emptyOnboardingMail,
    type OnboardingMailStatus,
  } from './onboardingTypes.js'
  import { resizeMainWindowToBrowserLikeWorkArea } from '../desktop/browserLikeWindow.js'
  import VaultSetupStep from './VaultSetupStep.svelte'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'

  interface Props {
    onComplete: () => Promise<void>
    refreshStatus: () => Promise<void>
    /** True when no vault verifier exists yet — first onboarding screen is vault password. */
    needsVaultSetup: boolean
  }
  let { onComplete, refreshStatus, needsVaultSetup }: Props = $props()

  let state = $state<string>('not-started')
  /** From server; used for indexing-step copy (Apple vs Google). */
  let mailProviderPref = $state<'apple' | 'google' | null>(null)
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

  let draftMarkdown = $state('')
  /** Bump to remount {@link ProfileDraftEditor} after reload-from-disk (discards unsaved TipTap edits). */
  let draftEditorKey = $state(0)
  let profileDraftEditor = $state<{ flushSave: () => Promise<void> } | null>(null)
  let categoriesText = $state('People\nProjects\nInterests\nAreas')

  let onboardingExitHandled = $state(false)
  /** Tauri: true after we’ve applied the “browser-sized” window for late onboarding (profiling onward). */
  let onboardingLargeWindowApplied = $state(false)
  const mailIndexedCount = $derived(Math.max(mail.indexedTotal ?? 0, mail.ftsReady ?? 0))
  const canAutoProceedToProfiling = $derived(mailIndexedCount >= ONBOARDING_PROFILE_INDEX_AUTOPROCEED)
  const canOfferEarlyProfile = $derived(
    mailIndexedCount >= ONBOARDING_PROFILE_INDEX_MANUAL_MIN &&
      mailIndexedCount < ONBOARDING_PROFILE_INDEX_AUTOPROCEED,
  )
  const indexingProgressPercent = $derived(
    Math.min(
      100,
      Math.round((mailIndexedCount / ONBOARDING_PROFILE_INDEX_AUTOPROCEED) * 100),
    ),
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
    mailProviderPref = pref
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

  /** Wall-clock time on the indexing step so we can show “still working” without sounding stuck. */
  let indexingStartedAt = $state<number | null>(null)
  let indexingElapsedTick = $state(0)
  $effect(() => {
    if (state === 'indexing') {
      if (indexingStartedAt === null) indexingStartedAt = Date.now()
    } else {
      indexingStartedAt = null
    }
  })
  $effect(() => {
    if (state !== 'indexing') return
    const id = setInterval(() => {
      indexingElapsedTick += 1
    }, 5000)
    return () => clearInterval(id)
  })

  const indexingLeadParagraph = $derived.by(() => {
    if (mailProviderPref === 'google') {
      return 'We’re downloading your recent Gmail into Braintunnel so we can build your profile. Hang tight.'
    }
    if (mailProviderPref === 'apple') {
      return 'We’re copying your recent messages from Apple Mail into Braintunnel so we can build your profile. Hang tight.'
    }
    return 'We’re copying your recent messages into Braintunnel so we can build your profile. Hang tight.'
  })

  const indexingElapsedLine = $derived.by(() => {
    void indexingElapsedTick
    return buildIndexingElapsedLine(state, indexingStartedAt, Date.now())
  })

  /** After enough mail is indexed, advance to profiling. */
  let indexingToProfilingInitiated = $state(false)
  $effect(() => {
    if (state !== 'indexing') {
      indexingToProfilingInitiated = false
    }
  })

  const showIndexingHero = $derived(
    !needsVaultSetup &&
      (state === 'indexing' ||
        (state === 'not-started' && mail.configured && !setupError)),
  )

  const indexingStatusLine = $derived.by(() => {
    if (mailIndexedCount > 0) {
      return `${mailIndexedCount.toLocaleString()} messages`
    }
    if (mail.syncRunning) {
      return 'Sync is running…'
    }
    return ''
  })

  $effect(() => {
    if (state !== 'indexing' || !canAutoProceedToProfiling || busy) return
    if (indexingToProfilingInitiated) return
    indexingToProfilingInitiated = true
    void patchState('profiling').catch(() => {
      indexingToProfilingInitiated = false
    })
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
    await patchOnboardingState(next)
    indexingAdvanceError = null
    await refreshStatus()
    await load()
  }

  async function proceedToProfilingEarly() {
    indexingAdvanceError = null
    busy = true
    await tick()
    try {
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
      await load()
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
    await patchState('done')
    await onComplete()
  }

  $effect(() => {
    if (state === 'reviewing-profile') void loadDraft()
  })

</script>

<div
  class="onboarding flex h-full min-h-0 w-full flex-col bg-[var(--bg)] text-[var(--text)]"
  class:onboarding-wide={state !== 'profiling' && state !== 'reviewing-profile'}
>
  {#if state === 'profiling'}
    <OnboardingWorkspace
      chatEndpoint="/api/onboarding/profile"
      headerFallbackTitle="Profiling"
      storageKey=""
        autoSendMessage="From my indexed email, write a short me.md for my assistant: how to help me, tone, key roles, a few key people — lean and steering, not a full bio. Use the tools; keep it factual. Interests and projects will land in the wiki afterward."
      onStreamFinished={async () => { await patchState('reviewing-profile') }}
    />
  {:else if needsVaultSetup}
    <VaultSetupStep
      onComplete={async () => {
        await refreshStatus()
        await load()
      }}
    />
  {:else}
  <div
    class="onboarding-main flex min-h-0 flex-1 flex-col"
    class:onboarding-main-scroll={state !== 'reviewing-profile'}
    class:onboarding-main-review={state === 'reviewing-profile'}
  >
    {#if state === 'not-started' && !mail.configured}
      <OnboardingHeroShell>
          <span class="ob-kicker">Braintunnel</span>
          <h1 class="ob-headline">Your assistant, on your Mac</h1>
          <p class="ob-lead">
            Braintunnel is your local assistant for chat, email, and your notes—personalized to you.
            <strong>Mail, Messages, and your files stay on this Mac</strong>—you’re in control. Connect
            <strong>Apple</strong> or <strong>Google</strong> to seed mail and calendar—then add folders later to enrich.
          </p>

          <div class="ob-cta-group">
            {#if setupError}
              <p class="ob-error">{setupError}</p>
            {/if}
            <div class="ob-provider-row">
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
                to Braintunnel; we will continue automatically. If the tab did not open, use <strong>Open again</strong>. If
                Safari warns about <code>127.0.0.1</code>, that is your local Braintunnel server over HTTPS.
              </p>
            {/if}
            <p class="ob-fine-print">
              On Apple, Braintunnel indexes Mail from your library and registers your Mac calendars (same source as
              Calendar.app) for sync. Full Disk Access lets Braintunnel read Mail, Messages, and paths you choose.
              {#if isTauriRuntime()}
                The Braintunnel app opens Google in your default browser for sign-in (mail + calendar read).
              {:else}
                Google sign-in uses this browser (mail + calendar read).
              {/if}
              macOS may prompt for permissions during setup.
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
            {#if indexingStatusLine}
              <p class="ob-indexing-count">{indexingStatusLine}</p>
            {/if}
            <div class="ob-indexing-progress-bar" aria-hidden="true">
              <div class="ob-indexing-progress-fill" style:width="{indexingProgressPercent}%"></div>
            </div>
            {#if mail.indexingHint}
              <p class="ob-indexing-hint">{mail.indexingHint}</p>
            {/if}
            {#if indexingElapsedLine}
              <p class="ob-indexing-elapsed">{indexingElapsedLine}</p>
            {/if}
            {#if state === 'indexing' && canOfferEarlyProfile}
              <div class="ob-indexing-early" role="region" aria-label="Continue before full sync">
                <p class="ob-indexing-early-copy">
                  You’ve got enough mail for a strong first profile. We’ll keep downloading the rest in the background
                  while you talk with Braintunnel.
                </p>
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
                    Build my profile now
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

    {:else if state === 'done'}
      <OnboardingHeroShell>
          <h1 class="ob-headline">You're all set</h1>
          <p class="ob-lead">Your assistant is ready. We’ll keep building your wiki in the background.</p>
          <button type="button" class="ob-btn-primary" onclick={() => void onComplete()}>
            Open Braintunnel
            <svg class="ob-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
      </OnboardingHeroShell>
    {/if}
  </div>
  {/if}
</div>

<style>
  /* ── Layout shells ── */
  .onboarding-wide {
    max-width: min(960px, 100%);
    margin-inline: auto;
  }

  /**
   * Indexing: keep orbit + title stack fixed while optional hint / elapsed / error lines update.
   * The status slot reserves height (and caps overflow) so the centered column doesn’t jump when copy updates.
   */
  .ob-indexing-fixed {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    width: 100%;
  }

  .ob-indexing-lead {
    margin-bottom: 0;
  }

  .ob-indexing-status-slot {
    width: 100%;
    flex: 0 0 auto;
    min-height: 4rem;
    max-height: 14rem;
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 0.5rem;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .ob-indexing-visual {
    position: relative;
    width: 4.5rem;
    height: 4.5rem;
    margin: 0 auto 1.5rem;
  }

  .ob-indexing-orbit {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--accent) 38%, transparent);
    animation: ob-indexing-orbit-spin 2.8s linear infinite;
  }

  .ob-indexing-orbit-delayed {
    inset: 0.55rem;
    opacity: 0.75;
    animation-duration: 2s;
    animation-direction: reverse;
  }

  .ob-indexing-core {
    position: absolute;
    inset: 32%;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) 50%, var(--bg));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
    animation: ob-indexing-core-pulse 1.85s ease-in-out infinite;
  }

  @keyframes ob-indexing-orbit-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes ob-indexing-core-pulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(0.88);
      opacity: 0.82;
    }
  }

  .ob-indexing-hint,
  .ob-indexing-elapsed,
  .ob-indexing-count {
    margin: 0;
    max-width: 26rem;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--text-2);
    text-wrap: balance;
  }

  .ob-indexing-count {
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.25rem;
  }

  .ob-indexing-progress-bar {
    width: 100%;
    max-width: 18rem;
    height: 0.375rem;
    background: var(--bg-3, color-mix(in srgb, var(--bg-2) 80%, var(--text) 20%));
    border-radius: 1rem;
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .ob-indexing-progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 1rem;
    transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .ob-indexing-elapsed {
    font-size: 0.8125rem;
    opacity: 0.95;
  }

  .ob-indexing-early {
    margin-top: 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.875rem;
    max-width: 24rem;
    text-align: center;
  }

  .ob-indexing-early-copy {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-2);
    text-wrap: balance;
  }

  .ob-indexing-early-btn {
    min-width: 12rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .ob-indexing-orbit,
    .ob-indexing-orbit-delayed,
    .ob-indexing-core {
      animation: none;
    }
  }

  .ob-review-error {
    margin: 0.5rem 0 0;
    max-width: 42rem;
  }

  .onboarding-main-scroll {
    overflow-y: auto;
  }

  .onboarding-main-review {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  /* ── Review profile: header, scrollable editor, sticky footer ── */
  .ob-review {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: none;
    margin-inline: 0;
    padding: 0;
    box-sizing: border-box;
    gap: 0;
  }

  .ob-review-top {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.875rem clamp(1rem, 3vw, 2.5rem);
    margin: 0;
    border-radius: 0;
    background: var(--bg-2);
    border: none;
    border-bottom: 1px solid var(--border);
    box-shadow: none;
  }

  @media (min-width: 640px) {
    .ob-review-top {
      padding: 1rem clamp(1rem, 3vw, 2.5rem);
    }
  }

  .ob-review-header {
    flex: 1;
    min-width: 0;
  }

  .ob-review-title {
    font-size: 1.1875rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
    color: var(--text);
    margin: 0;
  }

  @media (min-width: 640px) {
    .ob-review-title {
      font-size: 1.3125rem;
    }
  }

  .ob-review-lead {
    font-size: 0.875rem;
    line-height: 1.55;
    color: var(--text-2);
    margin: 0.5rem 0 0;
    max-width: 42rem;
    text-wrap: pretty;
  }

  .ob-review-footer {
    position: sticky;
    bottom: 0;
    z-index: 6;
    flex-shrink: 0;
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem clamp(1rem, 3vw, 2.5rem);
    background: color-mix(in srgb, var(--bg-2) 92%, var(--bg));
    border-top: 1px solid var(--border);
    backdrop-filter: blur(8px);
  }

  @media (min-width: 640px) {
    .ob-review-footer {
      padding: 0.5rem clamp(1rem, 3vw, 2.5rem);
    }
  }

  .ob-review-actions {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.375rem 0.5rem;
    width: 100%;
    max-width: var(--chat-column-max);
    margin-inline: auto;
  }

  .ob-review-secondary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
    justify-content: flex-end;
    flex: 1 1 auto;
    min-width: 0;
  }

  .ob-review-footer .ob-review-secondary-btn {
    padding: 0.3125rem 0.625rem;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 0.375rem;
  }

  .ob-review-footer .ob-review-cta {
    padding: 0.3125rem 0.75rem;
    min-height: unset;
    font-size: 0.75rem;
    font-weight: 600;
    border-radius: 0.375rem;
    justify-content: center;
    gap: 0.25rem;
  }

  .ob-review-footer .ob-review-cta .ob-btn-icon {
    width: 0.75rem;
    height: 0.75rem;
    margin-left: 0;
  }

  .ob-review-editor {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: clamp(0.5rem, 1.5vw, 0.75rem) clamp(1rem, 3vw, 2.5rem) 0;
    box-sizing: border-box;
  }

  .ob-indexing-mail-error {
    margin: 0;
    max-width: 22rem;
    max-height: 5rem;
    overflow-y: auto;
    text-align: center;
  }

  /* ── Secondary buttons ── */
  .ob-btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.6875rem 1.5rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--text);
    background: var(--bg-2);
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }
  .ob-btn-secondary:hover:not(:disabled) {
    background: var(--bg-3, color-mix(in srgb, var(--bg-2) 80%, var(--text) 20%));
  }
  .ob-btn-secondary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
