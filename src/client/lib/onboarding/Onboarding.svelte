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
    }
  }

  let state = $state<string>('not-started')
  let mail = $state<MailApi>(emptyMail())
  let setupError = $state<string | null>(null)
  let busy = $state(false)

  let draftMarkdown = $state('')
  let profileDraftEditor = $state<{ flushSave: () => Promise<void> } | null>(null)
  let categoriesText = $state('People\nProjects\nInterests\nAreas')

  /** Seeding: enough wiki pages to offer early exit to main app. */
  let seedThresholdMet = $state(false)
  let seedReadyDialogEl = $state<HTMLDialogElement | null>(null)
  let onboardingExitHandled = $state(false)

  const showMailFooter = $derived(
    (state === 'not-started' || state === 'indexing') &&
      ((mail.indexedTotal ?? 0) > 0 || mail.syncRunning),
  )
  const mailHasData = $derived((mail.indexedTotal ?? 0) > 0)
  const MIN_INDEXED_FOR_PROFILE = 1000
  const canBuildProfile = $derived((mail.indexedTotal ?? 0) >= MIN_INDEXED_FOR_PROFILE)

  function fmtDateLabel(s: string | null): string {
    if (!s) return '—'
    const t = Date.parse(s)
    if (Number.isNaN(t)) return s
    return new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' })
  }

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

  async function continueFromIndexing() {
    busy = true
    try {
      await patchState('profiling')
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
    busy = true
    try {
      await profileDraftEditor?.flushSave()
      const res = await fetch('/api/onboarding/accept-profile', { method: 'POST' })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string }
        throw new Error(j.error ?? 'Accept failed')
      }
      // Skip the categories step and go straight to seeding with defaults
      await prepareSeed()
    } finally {
      busy = false
    }
  }

  async function prepareSeed() {
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
        autoSendMessage="Read me.md, then create useful wiki pages from the profile and email evidence — build independent pages in parallel where you can, then do a final pass to review and fix internal links. Narrate briefly as you go."
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
          <h1 class="ob-headline">Let's get started</h1>
          <p class="ob-lead">
            Connect Apple Mail on this Mac so your assistant can work with your email.
          </p>

          <div class="ob-cta-group">
            {#if mail.configured}
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
                onclick={() => {
                  busy = true
                  void patchState('indexing').finally(() => { busy = false })
                }}
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
                Brain reads your mail from the Apple Mail library on this computer —
                not from a separate login. If setup fails with “Mail” or “Full Disk Access”,
                confirm <strong>Brain</strong> is allowed under
                <strong>System Settings → Privacy &amp; Security → Full Disk Access</strong>
                (toggles can look grey in screenshots), then quit Brain (Cmd+Q) and try again.
              </p>
            {/if}
          </div>
        </div>
      </div>

    {:else if state === 'indexing'}
      <div class="ob-hero">
        <div class="ob-hero-inner">
          <span class="ob-kicker">Brain</span>
          <h1 class="ob-headline">Indexing your mail</h1>
          <p class="ob-lead">
            Once we have enough email we can start building your profile.
          </p>
          <div class="ob-indexing-cta">
            {#if canBuildProfile}
              <button
                type="button"
                class="ob-btn-primary"
                onclick={() => void continueFromIndexing()}
                disabled={busy}
              >
                {busy ? 'Working…' : 'Build my profile'}
              </button>
            {/if}
          </div>
        </div>
      </div>

    {:else if state === 'reviewing-profile'}
      <section class="ob-review" aria-labelledby="ob-review-title">
        <div class="ob-review-row">
          <div class="ob-review-editor">
            <ProfileDraftEditor
              bind:this={profileDraftEditor}
              initialMarkdown={draftMarkdown}
              disabled={busy}
            />
          </div>
          <aside class="ob-review-aside" aria-label="Review instructions">
            <header class="ob-review-header">
              <h2 id="ob-review-title" class="ob-section-title">Review your profile</h2>
              <p class="ob-review-lead">
                This is your personal profile. Your assistant will refer to it to stay updated on your projects, key contacts, and interests. Take a moment to edit anything that isn't quite right.
              </p>
            </header>
            <div class="ob-review-actions">
              <button type="button" class="ob-btn-primary ob-btn-block" onclick={() => void acceptProfile()} disabled={busy}>
                {busy ? 'Saving…' : 'Looks good'}
              </button>
            </div>
          </aside>
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

  {#if showMailFooter}
    <footer class="ob-footer">
      <div class="ob-footer-grid">
        <div class="ob-footer-stat">
          <span class="ob-footer-label">Indexed</span>
          <span class="ob-footer-value">{mail.indexedTotal != null ? mail.indexedTotal : '—'}</span>
        </div>
        <div class="ob-footer-stat">
          <span class="ob-footer-label">Date range</span>
          <span class="ob-footer-value">
            {#if mail.dateRange.from || mail.dateRange.to}
              {fmtDateLabel(mail.dateRange.from)} – {fmtDateLabel(mail.dateRange.to)}
            {:else}
              —
            {/if}
          </span>
        </div>
        {#if mail.syncRunning}
          <div class="ob-footer-stat">
            <span class="ob-sync-dot" aria-hidden="true"></span>
            <span class="ob-footer-label">Syncing…</span>
          </div>
        {/if}
      </div>
      {#if mail.statusError}
        <p class="ob-footer-error">{mail.statusError}</p>
      {/if}
      <div class="ob-progress-track" aria-hidden="true">
        <div
          class="ob-progress-bar"
          style="width: {mail.syncRunning ? '45%' : mailHasData ? '100%' : '12%'}"
        ></div>
      </div>
    </footer>
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
  .ob-btn-block {
    width: 100%;
  }
  .ob-btn-icon {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
  }
  /* Reserve one primary-button row so the hero doesn’t jump when indexing crosses the threshold. */
  .ob-indexing-cta {
    margin-top: 2.5rem;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: calc(0.8125rem * 2 + 1.25em);
    font-size: 0.9375rem;
    box-sizing: border-box;
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

  .onboarding-main-scroll {
    overflow-y: auto;
  }

  .onboarding-main-review {
    overflow: hidden;
    min-height: 0;
  }

  /* ── Review profile: editor left, instructions + CTA right (stacked on small screens) ── */
  .ob-review {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: none;
    margin-inline: 0;
    padding: clamp(1rem, 2.5vw, 1.75rem) clamp(1rem, 3vw, 2.5rem) clamp(1.25rem, 2.5vw, 2rem);
    box-sizing: border-box;
  }

  .ob-review-row {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
    width: 100%;
  }

  @media (min-width: 768px) {
    .ob-review-row {
      flex-direction: row;
      align-items: stretch;
      gap: 1.25rem;
    }
  }

  .ob-review-editor {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    order: 1;
  }

  .ob-review-aside {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    order: 2;
  }

  @media (min-width: 768px) {
    .ob-review-aside {
      width: min(20rem, 32vw);
      max-width: 22rem;
      padding-left: 1.25rem;
      border-left: 1px solid var(--border);
      gap: 1.25rem;
    }
  }

  .ob-review-header {
    flex-shrink: 0;
  }

  .ob-review-lead {
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--text-2);
    margin-top: 0.5rem;
  }

  @media (min-width: 768px) {
    .ob-review-lead {
      max-width: none;
    }
  }

  .ob-review-actions {
    flex-shrink: 0;
    margin-top: auto;
  }

  @media (max-width: 767.98px) {
    .ob-review-actions {
      margin-top: 0;
    }
  }

  .ob-section-title {
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text);
    margin-bottom: 0.25rem;
  }
  /* ── Footer ── */
  .ob-footer {
    flex-shrink: 0;
    border-top: 1px solid var(--border);
    background: var(--bg);
    padding: 1rem 1.25rem;
  }
  @media (min-width: 640px) {
    .ob-footer { padding: 1rem 1.5rem; }
  }
  .ob-footer-grid {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    gap: 0.25rem 1.5rem;
    max-width: 36rem;
    margin-inline: auto;
    font-size: 0.8125rem;
  }
  .ob-footer-stat {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
  }
  .ob-footer-label {
    color: var(--text-2);
  }
  .ob-footer-value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .ob-footer-error {
    max-width: 36rem;
    margin: 0.5rem auto 0;
    font-size: 0.75rem;
    color: var(--danger, #e05c5c);
    text-align: center;
  }
  .ob-sync-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--accent);
    animation: ob-pulse 1.5s ease-in-out infinite;
    align-self: center;
  }
  @keyframes ob-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .ob-progress-track {
    max-width: 36rem;
    margin: 0.75rem auto 0;
    height: 3px;
    border-radius: 2px;
    background: var(--border);
    overflow: hidden;
  }
  .ob-progress-bar {
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width 0.7s ease;
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
