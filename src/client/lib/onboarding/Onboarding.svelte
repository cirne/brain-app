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
  } from './onboardingApi.js'
  import { buildIndexingElapsedLine } from './onboardingIndexingUi.js'
  import {
    ONBOARDING_LARGE_WINDOW_STATES,
    emptyOnboardingMail,
    MIN_INDEXED_FOR_PROFILE,
    type OnboardingMailStatus,
  } from './onboardingTypes.js'
  import { resizeMainWindowToBrowserLikeWorkArea } from '../desktop/browserLikeWindow.js'

  interface Props {
    onComplete: () => Promise<void>
    refreshStatus: () => Promise<void>
  }
  let { onComplete, refreshStatus }: Props = $props()

  let state = $state<string>('not-started')
  /** From server; used for indexing-step copy (Apple vs Google). */
  let mailProviderPref = $state<'apple' | 'google' | null>(null)
  let mail = $state<OnboardingMailStatus>(emptyOnboardingMail())
  let setupError = $state<string | null>(null)
  /** Review / accept-profile / confirming-categories recovery */
  let profileStepError = $state<string | null>(null)
  let busy = $state(false)

  let draftMarkdown = $state('')
  /** Bump to remount {@link ProfileDraftEditor} after reload-from-disk (discards unsaved TipTap edits). */
  let draftEditorKey = $state(0)
  let profileDraftEditor = $state<{ flushSave: () => Promise<void> } | null>(null)
  let categoriesText = $state('People\nProjects\nInterests\nAreas')

  let onboardingExitHandled = $state(false)
  /** Tauri: true after we’ve applied the “browser-sized” window for late onboarding (profiling onward). */
  let onboardingLargeWindowApplied = $state(false)

  /** Legacy onboarding: migrate old `seeding` / `confirming-categories` to main app. */
  let legacySeedingRecoverDone = $state(false)

  const canBuildProfile = $derived((mail.indexedTotal ?? 0) >= MIN_INDEXED_FOR_PROFILE)
  const indexingProgressPercent = $derived(
    Math.min(100, Math.round(((mail.indexedTotal ?? 0) / MIN_INDEXED_FOR_PROFILE) * 100)),
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
      return 'We’re downloading your recent Gmail into Brain so we can build your profile. Hang tight.'
    }
    if (mailProviderPref === 'apple') {
      return 'We’re copying your recent messages from Apple Mail into Brain so we can build your profile. Hang tight.'
    }
    return 'We’re copying your recent messages into Brain so we can build your profile. Hang tight.'
  })

  const indexingElapsedLine = $derived.by(() => {
    void indexingElapsedTick
    return buildIndexingElapsedLine(state, indexingStartedAt, Date.now())
  })

  /** After enough mail is indexed, advance to profiling. */
  let indexingToProfilingInitiated = $state(false)
  $effect(() => {
    if (state === 'not-started') indexingToProfilingInitiated = false
  })

  const showIndexingHero = $derived(
    state === 'indexing' ||
      (state === 'not-started' && mail.configured && !setupError),
  )

  const indexingStatusLine = $derived.by(() => {
    if ((mail.indexedTotal ?? 0) > 0) {
      return `${mail.indexedTotal.toLocaleString()} messages`
    }
    if (mail.syncRunning) {
      return 'Sync is running…'
    }
    return ''
  })

  $effect(() => {
    if (state !== 'indexing' || !canBuildProfile || busy) return
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
    await refreshStatus()
    await load()
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

  async function startGoogleMail() {
    setupError = null
    try {
      await patchOnboardingPreferences('google')
    } catch {
      /* non-fatal */
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

  $effect(() => {
    if (state !== 'seeding' && state !== 'confirming-categories') {
      legacySeedingRecoverDone = false
      return
    }
    if (legacySeedingRecoverDone || busy) return
    legacySeedingRecoverDone = true
    void (async () => {
      try {
        await patchState('done')
        await refreshStatus()
        await load()
        await onComplete()
      } catch {
        legacySeedingRecoverDone = false
      }
    })()
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
  {:else}
  <div
    class="onboarding-main flex min-h-0 flex-1 flex-col"
    class:onboarding-main-scroll={state !== 'reviewing-profile'}
    class:onboarding-main-review={state === 'reviewing-profile'}
  >
    {#if state === 'not-started' && !mail.configured}
      <div class="ob-hero">
        <div class="ob-hero-inner">
          <span class="ob-kicker">Brain</span>
          <h1 class="ob-headline">Your assistant, on your Mac</h1>
          <p class="ob-lead">
            Brain is your local assistant for chat, email, and your notes—personalized to you.
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
                Google
              </button>
            </div>
            <p class="ob-fine-print">
              On Apple, Brain indexes Mail from your library and registers your Mac calendars (same source as
              Calendar.app) for sync. Full Disk Access lets Brain read Mail, Messages, and paths you choose. Google opens a
              browser sign-in (mail + calendar read). macOS may prompt for permissions during setup.
            </p>
          </div>
        </div>
      </div>

    {:else if state === 'not-started' && mail.configured && setupError}
      <div class="ob-hero">
        <div class="ob-hero-inner">
          <span class="ob-kicker">Brain</span>
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
        </div>
      </div>

    {:else if showIndexingHero}
      <div class="ob-hero ob-hero--indexing" aria-busy="true">
        <div class="ob-hero-inner ob-indexing-hero-inner">
          <div class="ob-indexing-fixed">
            <div class="ob-indexing-visual" aria-hidden="true">
              <span class="ob-indexing-orbit"></span>
              <span class="ob-indexing-orbit ob-indexing-orbit-delayed"></span>
              <span class="ob-indexing-core"></span>
            </div>
            <span class="ob-kicker">Brain</span>
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
            {#if mail.statusError}
              <p class="ob-error ob-indexing-mail-error">{mail.statusError}</p>
            {/if}
          </div>
        </div>
      </div>

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
      <div class="ob-hero">
        <div class="ob-hero-inner">
          <h1 class="ob-headline">You're all set</h1>
          <p class="ob-lead">Your assistant is ready. We’ll keep building your wiki in the background.</p>
          <button type="button" class="ob-btn-primary" onclick={() => void onComplete()}>
            Open Brain
            <svg class="ob-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </button>
        </div>
      </div>
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

  /* ── Hero (centered full-height steps) ── */
  .ob-hero {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-height: min(560px, 85vh);
    padding: 3.5rem 1.5rem;
  }
  @media (min-width: 640px) {
    .ob-hero { padding: 4rem 2rem; }
  }
  .ob-hero-inner {
    width: 100%;
    max-width: 28rem;
    text-align: center;
  }

  /**
   * Indexing: keep orbit + title stack fixed while optional hint / elapsed / error lines update.
   * The status slot reserves height (and caps overflow) so the centered column doesn’t jump when copy updates.
   */
  .ob-hero--indexing {
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 0;
  }

  .ob-indexing-hero-inner {
    max-width: 22rem;
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }

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

  @media (prefers-reduced-motion: reduce) {
    .ob-indexing-orbit,
    .ob-indexing-orbit-delayed,
    .ob-indexing-core {
      animation: none;
    }
  }

  /* ── Typography ── */
  .ob-kicker {
    display: block;
    margin-bottom: 0.75rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .ob-headline {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.2;
    color: var(--text);
    text-wrap: balance;
  }
  @media (min-width: 640px) {
    .ob-headline { font-size: 2.25rem; }
  }
  .ob-lead {
    margin-top: 1rem;
    font-size: 1.0625rem;
    line-height: 1.6;
    color: var(--text-2);
    text-wrap: pretty;
  }
  .ob-fine-print {
    font-size: 0.8125rem;
    line-height: 1.45;
    color: color-mix(in srgb, var(--text-2) 70%, transparent);
    max-width: 22rem;
  }
  /* ── CTA area ── */
  .ob-cta-group {
    margin-top: 2.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.75rem;
  }

  .ob-provider-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: center;
    width: 100%;
    max-width: 28rem;
  }

  /* Paired provider tiles (icons can be added later as inline SVGs). */
  .ob-btn-provider {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-width: 10.5rem;
    padding: 0.75rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: var(--text);
    background: var(--bg-2);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.1s, opacity 0.15s;
    -webkit-font-smoothing: antialiased;
  }
  .ob-btn-provider:hover:not(:disabled) {
    background: var(--bg-3, color-mix(in srgb, var(--bg-2) 80%, var(--text) 20%));
    border-color: color-mix(in srgb, var(--border) 65%, var(--text) 35%);
  }
  .ob-btn-provider:active:not(:disabled) {
    transform: scale(0.98);
  }
  .ob-btn-provider:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .ob-spinner--provider {
    border-color: color-mix(in srgb, var(--text) 25%, transparent);
    border-top-color: var(--text);
  }

  /* ── Buttons ── */
  .ob-btn-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.8125rem 2rem;
    border: none;
    border-radius: 0.75rem;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    color: #fff;
    background: var(--accent);
    cursor: pointer;
    transition: background 0.15s, transform 0.1s, opacity 0.15s;
    -webkit-font-smoothing: antialiased;
  }
  .ob-btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .ob-btn-primary:active:not(:disabled) {
    transform: scale(0.97);
  }
  .ob-btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .ob-btn-icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  .ob-spinner {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: ob-spin 0.6s linear infinite;
  }
  @keyframes ob-spin {
    to { transform: rotate(360deg); }
  }

  .ob-error {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--danger, #e05c5c);
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
