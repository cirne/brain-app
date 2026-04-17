<script lang="ts">
  import { onMount, tick } from 'svelte'
  import OnboardingWorkspace from './OnboardingWorkspace.svelte'
  import ProfileDraftEditor from './ProfileDraftEditor.svelte'
  import {
    ONBOARDING_PROFILE_CHAT_STORAGE_KEY,
    ONBOARDING_SEED_CHAT_STORAGE_KEY,
  } from './onboardingStorageKeys.js'
  import {
    FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY,
    SEED_EARLY_EXIT_MIN_PAGES,
  } from './seedConstants.js'
  import { resizeMainWindowToBrowserLikeWorkArea } from '../desktop/browserLikeWindow.js'

  const ONBOARDING_LARGE_WINDOW_STATES = new Set([
    'profiling',
    'reviewing-profile',
    'seeding',
    'done',
  ])

  interface Props {
    onComplete: () => Promise<void>
    refreshStatus: () => Promise<void>
  }
  let { onComplete, refreshStatus }: Props = $props()

  type MailApi = {
    configured: boolean
    indexedTotal: number | null
    lastSyncedAt: string | null
    dateRange: { from: string | null; to: string | null }
    syncRunning: boolean
    ftsReady: number | null
    indexingHint?: string | null
    statusError?: string
  }

  function emptyMail(): MailApi {
    return {
      configured: false,
      indexedTotal: null,
      lastSyncedAt: null,
      dateRange: { from: null, to: null },
      syncRunning: false,
      ftsReady: null,
      indexingHint: null,
    }
  }

  let state = $state<string>('not-started')
  let mail = $state<MailApi>(emptyMail())
  let setupError = $state<string | null>(null)
  /** Review / accept-profile / confirming-categories recovery */
  let profileStepError = $state<string | null>(null)
  let busy = $state(false)

  let draftMarkdown = $state('')
  let profileDraftEditor = $state<{ flushSave: () => Promise<void> } | null>(null)
  let categoriesText = $state('People\nProjects\nInterests\nAreas')

  /** Seeding: enough wiki pages to offer early exit to main app. */
  let seedThresholdMet = $state(false)
  let seedReadyDialogEl = $state<HTMLDialogElement | null>(null)
  let onboardingExitHandled = $state(false)
  /** Tauri: true after we’ve applied the “browser-sized” window for late onboarding (profiling onward). */
  let onboardingLargeWindowApplied = $state(false)

  /** Legacy / partial failure: auto-run prepare-seed once when landing on confirming-categories. */
  let confirmingAutoRecoverDone = $state(false)

  const MIN_INDEXED_FOR_PROFILE = 1000
  const canBuildProfile = $derived((mail.indexedTotal ?? 0) >= MIN_INDEXED_FOR_PROFILE)

  async function loadMailOnly() {
    try {
      const res = await fetch('/api/onboarding/mail')
      const j = (await res.json()) as Partial<MailApi>
      const base = emptyMail()
      mail = {
        ...base,
        ...j,
        dateRange: {
          ...base.dateRange,
          ...(j.dateRange ?? {}),
        },
      }
    } catch {
      /* keep prior */
    }
  }

  async function load() {
    const res = await fetch('/api/onboarding/status')
    const j = (await res.json()) as { state: string }
    state = j.state
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
    }, 15000)
    return () => clearInterval(id)
  })
  const indexingElapsedLine = $derived.by(() => {
    void indexingElapsedTick
    if (state !== 'indexing' || indexingStartedAt === null) return null
    const min = Math.floor((Date.now() - indexingStartedAt) / 60000)
    if (min < 2) return null
    if (min < 5) {
      return 'Still working — the first batch can take a few minutes on a large mailbox.'
    }
    return `About ${min} minutes so far — you can leave this screen open; we’ll continue in the background.`
  })

  /** After enough mail is indexed, leave indexing without a manual “proceed” tap. */
  let indexingToProfilingInitiated = $state(false)
  $effect(() => {
    if (state === 'not-started') indexingToProfilingInitiated = false
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
    const res = await fetch('/api/onboarding/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: next }),
    })
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(e.error ?? res.statusText)
    }
    await refreshStatus()
    await load()
  }

  /** Start background mail sync, then enter indexing (same as post–setup flow). */
  async function continueToIndexing() {
    setupError = null
    busy = true
    await tick()
    try {
      const syncRes = await fetch('/api/inbox/sync', { method: 'POST' })
      const syncBody = (await syncRes.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!syncRes.ok || !syncBody.ok) {
        setupError = syncBody.error ?? 'Could not start indexing your mail. Try again.'
        return
      }
      await patchState('indexing')
    } catch (e) {
      setupError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function setupAppleMail() {
    setupError = null
    busy = true
    await tick()
    try {
      const res = await fetch('/api/onboarding/setup-mail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        // Server waits for `ripmail setup` (up to 120s) before responding; keep UI responsive with spinner above.
        signal: AbortSignal.timeout(125_000),
      })
      const raw = await res.text()
      let j: { ok?: boolean; error?: string }
      try {
        j = JSON.parse(raw) as { ok?: boolean; error?: string }
      } catch {
        setupError =
          raw.trim().length > 0
            ? `Setup failed (${res.status}): ${raw.slice(0, 400)}`
            : `Setup failed (${res.status}): empty or non-JSON response`
        return
      }
      if (!res.ok || !j.ok) {
        setupError = j.error ?? 'Setup failed'
        return
      }
      await fetch('/api/inbox/sync', { method: 'POST' })
      await patchState('indexing')
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setupError =
          'Setup took too long (over 2 minutes). The bundled server logs Hono and ripmail output to ~/Library/Logs/com.cirne.brain/node-server.log — tail that file to see progress or errors.'
      } else {
        setupError = e instanceof Error ? e.message : String(e)
      }
    } finally {
      busy = false
    }
  }

  async function loadDraft() {
    const res = await fetch('/api/onboarding/profile-draft')
    if (res.ok) {
      const j = (await res.json()) as { markdown: string }
      draftMarkdown = j.markdown
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
      const res = await fetch('/api/onboarding/accept-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string }
        throw new Error(j.error ?? 'Accept failed')
      }
      await refreshStatus()
      await load()
    } catch (e) {
      profileStepError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function prepareSeed() {
    profileStepError = null
    const categories = categoriesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    busy = true
    try {
      const res = await fetch('/api/onboarding/prepare-seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string }
        throw new Error(j.error ?? 'prepare-seed failed')
      }
      await refreshStatus()
      await load()
    } catch (e) {
      profileStepError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function finishOnboarding() {
    if (onboardingExitHandled) return
    onboardingExitHandled = true
    try {
      sessionStorage.setItem(FRESH_CHAT_AFTER_ONBOARDING_SESSION_KEY, '1')
    } catch {
      /* ignore */
    }
    try {
      seedReadyDialogEl?.close()
    } catch {
      /* ignore */
    }
    await patchState('done')
    await onComplete()
  }

  function handleSeedWikiActivity(info: { pageCount: number; lastDocPath: string | null }) {
    if (onboardingExitHandled || seedThresholdMet) return
    if (info.pageCount >= SEED_EARLY_EXIT_MIN_PAGES) {
      seedThresholdMet = true
    }
  }

  async function handleSeedStreamFinished() {
    if (onboardingExitHandled) return
    if (seedThresholdMet) {
      /* Interstitial is (or will be) shown — user confirms with “Start chatting”. */
      return
    }
    await finishOnboarding()
  }

  function onSeedReadyDialogCancel(e: Event) {
    e.preventDefault()
  }

  async function onSeedReadyConfirm() {
    await finishOnboarding()
  }

  $effect(() => {
    if (state !== 'seeding' || !seedThresholdMet) return
    const el = seedReadyDialogEl
    if (!el) return
    void tick().then(() => {
      if (el.isConnected && !el.open) el.showModal()
    })
  })

  $effect(() => {
    if (state === 'reviewing-profile') void loadDraft()
  })

  $effect(() => {
    if (state !== 'confirming-categories') {
      confirmingAutoRecoverDone = false
      return
    }
    if (confirmingAutoRecoverDone || busy) return
    confirmingAutoRecoverDone = true
    void prepareSeed()
  })
</script>

<div
  class="onboarding flex h-full min-h-0 w-full flex-col bg-[var(--bg)] text-[var(--text)]"
  class:onboarding-wide={state !== 'profiling' && state !== 'seeding' && state !== 'reviewing-profile'}
>
  {#if state === 'profiling'}
    <OnboardingWorkspace
      chatEndpoint="/api/onboarding/profile"
      headerFallbackTitle="Profiling"
      storageKey={ONBOARDING_PROFILE_CHAT_STORAGE_KEY}
      autoSendMessage="Build a short essentials-only profile in me.md (name, key people, interests, projects, contact) from my email using tools — not a long dossier."
      onStreamFinished={async () => { await patchState('reviewing-profile') }}
    />
  {:else if state === 'seeding'}
    <div class="ob-seed-shell flex min-h-0 flex-1 flex-col">
      <OnboardingWorkspace
        chatEndpoint="/api/onboarding/seed"
        headerFallbackTitle="Seeding"
        storageKey={ONBOARDING_SEED_CHAT_STORAGE_KEY}
        suppressAgentDetailAutoOpen
        autoSendMessage="Read me.md, then create useful wiki pages from the profile and email evidence — do not duplicate the main user in a separate page (me.md is the profile). Build independent pages in parallel where you can, then do a final pass to review and fix internal links. Narrate briefly as you go."
        onSeedWikiActivity={handleSeedWikiActivity}
        onStreamFinished={handleSeedStreamFinished}
      />
      {#if seedThresholdMet}
        <dialog
          bind:this={seedReadyDialogEl}
          class="ob-seed-ready-dialog"
          oncancel={onSeedReadyDialogCancel}
          aria-labelledby="ob-seed-ready-title"
          aria-describedby="ob-seed-ready-desc"
        >
          <div class="ob-seed-ready-inner">
            <h2 id="ob-seed-ready-title" class="ob-seed-ready-title">You’re off to a strong start</h2>
            <p id="ob-seed-ready-desc" class="ob-seed-ready-body">
              You’ve got a solid start. More pages may appear over the next few minutes as we finish setting things up. That’s normal. Feel free to start chatting whenever you like; answers can draw on what’s already in your space.
            </p>
            <p class="ob-seed-ready-foot">
              Want more later? Just ask your assistant to keep building things out.
            </p>
            <button type="button" class="ob-btn-primary ob-seed-ready-btn" onclick={() => void onSeedReadyConfirm()}>
              Start chatting
              <svg class="ob-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </div>
        </dialog>
      {/if}
    </div>
  {:else}
  <div
    class="onboarding-main flex min-h-0 flex-1 flex-col"
    class:onboarding-main-scroll={state !== 'reviewing-profile'}
    class:onboarding-main-review={state === 'reviewing-profile'}
  >
    {#if state === 'not-started'}
      <div class="ob-hero">
        <div class="ob-hero-inner">
          <span class="ob-kicker">Brain</span>
          <h1 class="ob-headline">Your assistant, on your Mac</h1>
          <p class="ob-lead">
            Brain is your local assistant for chat, email, and your notes—personalized to you.
            <strong>Mail, Messages, and your files stay on this Mac</strong>—you’re in control. Connect Apple Mail to get
            started.
          </p>

          <div class="ob-cta-group">
            {#if mail.configured}
              {#if setupError}
                <p class="ob-error">{setupError}</p>
              {/if}
              <div class="ob-notice">
                <p class="ob-notice-title">Mail connected</p>
                <p class="ob-notice-body">
                  Your Mac is already set up to share Apple Mail with Brain.
                  Continue when you're ready to index and build your profile.
                </p>
              </div>
              <button
                type="button"
                class="ob-btn-primary"
                onclick={() => void continueToIndexing()}
                disabled={busy}
              >
                {#if busy}
                  <span class="ob-spinner" aria-hidden="true"></span> Working…
                {:else}
                  Continue
                  <svg class="ob-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                {/if}
              </button>
            {:else}
              {#if setupError}
                <p class="ob-error">{setupError}</p>
              {/if}
              <button
                type="button"
                class="ob-btn-primary"
                onclick={() => void setupAppleMail()}
                disabled={busy}
              >
                {#if busy}
                  <span class="ob-spinner" aria-hidden="true"></span> Setting up…
                {:else}
                  <svg class="ob-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  Connect Apple Mail
                {/if}
              </button>
              <p class="ob-fine-print">
                MacOS may ask for <strong>Full Disk Access</strong> so Brain can read Mail, Messages, and files on this Mac—the
                depth needed for a truly personal assistant.
              </p>
            {/if}
          </div>
        </div>
      </div>

    {:else if state === 'indexing'}
      <div class="ob-hero ob-hero--indexing" aria-busy="true">
        <div class="ob-hero-inner ob-indexing-hero-inner">
          <div class="ob-indexing-fixed">
            <div class="ob-indexing-visual" aria-hidden="true">
              <span class="ob-indexing-orbit"></span>
              <span class="ob-indexing-orbit ob-indexing-orbit-delayed"></span>
              <span class="ob-indexing-core"></span>
            </div>
            <span class="ob-kicker">Brain</span>
            <h1 class="ob-headline">Indexing your mail</h1>
            <p class="ob-lead ob-indexing-lead">
              We’re copying your recent messages from Apple Mail into Brain so we can build your profile. You can leave this screen open.
            </p>
          </div>
          <div class="ob-indexing-status-slot" aria-live="polite">
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

    {:else if state === 'confirming-categories'}
      <div class="ob-hero" aria-live="polite">
        <div class="ob-hero-inner">
          <span class="ob-kicker">Brain</span>
          <h1 class="ob-headline">Finishing setup</h1>
          <p class="ob-lead">Moving to wiki seeding…</p>
          {#if profileStepError}
            <p class="ob-error ob-confirming-recover-error">{profileStepError}</p>
            <button
              type="button"
              class="ob-btn-primary"
              onclick={() => void prepareSeed()}
              disabled={busy}
            >
              {#if busy}
                <span class="ob-spinner" aria-hidden="true"></span> Retrying…
              {:else}
                Try again
              {/if}
            </button>
          {/if}
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
          <div class="ob-review-actions">
            <button type="button" class="ob-btn-primary ob-review-cta" onclick={() => void acceptProfile()} disabled={busy}>
              <span>{busy ? 'Saving…' : 'Looks Good'}</span>
              <svg class="ob-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </div>
        </div>
        <div class="ob-review-editor">
          <ProfileDraftEditor
            bind:this={profileDraftEditor}
            initialMarkdown={draftMarkdown}
            disabled={busy}
          />
        </div>
      </section>

    {:else if state === 'done'}
      <div class="ob-hero">
        <div class="ob-hero-inner">
          <h1 class="ob-headline">You're all set</h1>
          <p class="ob-lead">Your library is seeded and ready. Jump in whenever you like.</p>
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
   * Indexing: keep orbit + title stack fixed while status lines (hint / elapsed / error) update.
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
    min-height: 7.5rem;
    max-height: 11rem;
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
  .ob-indexing-elapsed {
    margin: 0;
    max-width: 26rem;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--text-2);
    text-wrap: balance;
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
  .ob-fine-print strong {
    font-weight: 600;
    color: var(--text-2);
  }

  /* ── CTA area ── */
  .ob-cta-group {
    margin-top: 2.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.75rem;
  }

  /* ── Notice (mail-connected card) ── */
  .ob-notice {
    text-align: center;
  }
  .ob-notice-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.375rem;
  }
  .ob-notice-body {
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--text-2);
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

  .ob-confirming-recover-error {
    margin: 1rem 0 0;
  }

  .onboarding-main-scroll {
    overflow-y: auto;
  }

  .onboarding-main-review {
    overflow-x: hidden;
    overflow-y: auto;
    min-height: 0;
  }

  /* ── Review profile: flat full-width sticky header, editor below ── */
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
    position: sticky;
    top: 0;
    z-index: 5;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
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
      flex-direction: row;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1.25rem 1.5rem;
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

  .ob-review-actions {
    flex-shrink: 0;
    display: flex;
    justify-content: stretch;
  }

  @media (min-width: 640px) {
    .ob-review-actions {
      align-self: center;
      justify-content: flex-end;
    }
  }

  .ob-review-cta {
    width: 100%;
    min-height: 2.125rem;
    padding: 0.4375rem 0.875rem;
    font-size: 0.8125rem;
    font-weight: 600;
    border-radius: 0.5rem;
    justify-content: center;
    gap: 0.375rem;
  }

  @media (min-width: 640px) {
    .ob-review-cta {
      width: auto;
      min-width: unset;
    }
  }

  .ob-review-cta .ob-btn-icon {
    width: 0.875rem;
    height: 0.875rem;
    margin-left: 0;
  }

  .ob-review-editor {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: clamp(0.75rem, 2vw, 1rem) clamp(1rem, 3vw, 2.5rem) clamp(1rem, 2vw, 1.5rem);
    box-sizing: border-box;
  }

  .ob-indexing-mail-error {
    margin: 0;
    max-width: 22rem;
    max-height: 5rem;
    overflow-y: auto;
    text-align: center;
  }

  .ob-seed-shell {
    position: relative;
    width: 100%;
    min-height: 0;
  }

  /* Restore modal dialog centering (global * { margin:0 } strips UA margin:auto) */
  .ob-seed-ready-dialog {
    position: fixed;
    inset: 0;
    width: fit-content;
    max-width: min(28rem, calc(100vw - 2rem));
    height: fit-content;
    max-height: min(90vh, calc(100vh - 2rem));
    margin: auto;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
  }

  .ob-seed-ready-dialog::backdrop {
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
  }

  .ob-seed-ready-inner {
    padding: 2rem 1.75rem 1.75rem;
    text-align: center;
  }

  .ob-seed-ready-title {
    font-size: 1.375rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
    color: var(--text);
    margin: 0;
  }

  .ob-seed-ready-body {
    margin: 1rem 0 0;
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--text-2);
    text-wrap: pretty;
  }

  .ob-seed-ready-foot {
    margin: 1rem 0 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: color-mix(in srgb, var(--text-2) 88%, transparent);
  }

  .ob-seed-ready-btn {
    margin-top: 1.75rem;
  }
</style>
