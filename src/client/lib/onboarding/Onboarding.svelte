<script lang="ts">
  import { onMount } from 'svelte'
  import { renderMarkdown } from '../markdown.js'
  import OnboardingAgentChat from './OnboardingAgentChat.svelte'

  interface Props {
    onComplete: () => Promise<void>
    refreshStatus: () => Promise<void>
  }
  let { onComplete, refreshStatus }: Props = $props()

  let state = $state<string>('not-started')
  let ripmailConfigured = $state(false)
  let inboxCount = $state(0)
  let email = $state('')
  let password = $state('')
  let setupError = $state<string | null>(null)
  let busy = $state(false)

  let draftMarkdown = $state('')
  let categoriesText = $state('People\nProjects\nInterests\nAreas')

  async function load() {
    const res = await fetch('/api/onboarding/status')
    const j = (await res.json()) as { state: string }
    state = j.state
    const rm = await fetch('/api/onboarding/ripmail')
    const r = (await rm.json()) as { configured: boolean; inboxCount: number }
    ripmailConfigured = r.configured
    inboxCount = r.inboxCount
  }

  onMount(() => {
    void load()
    const t = setInterval(() => {
      if (['indexing', 'not-started'].includes(state)) void loadRipmailOnly()
    }, 3000)
    return () => clearInterval(t)
  })

  async function loadRipmailOnly() {
    try {
      const rm = await fetch('/api/onboarding/ripmail')
      const r = (await rm.json()) as { configured: boolean; inboxCount: number }
      ripmailConfigured = r.configured
      inboxCount = r.inboxCount
    } catch {
      /* ignore */
    }
  }

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

  async function setupRipmail() {
    setupError = null
    busy = true
    try {
      const res = await fetch('/api/onboarding/setup-ripmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const j = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) {
        setupError = j.error ?? 'Setup failed'
        return
      }
      await fetch('/api/inbox/sync', { method: 'POST' })
      await patchState('indexing')
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
      const res = await fetch('/api/onboarding/accept-profile', { method: 'POST' })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string }
        throw new Error(j.error ?? 'Accept failed')
      }
      await refreshStatus()
      await load()
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

  async function afterSeedComplete() {
    await patchState('done')
    await onComplete()
  }

  $effect(() => {
    if (state === 'reviewing-profile') void loadDraft()
  })
</script>

<div
  class="onboarding"
  class:onboarding-wide={state === 'profiling' || state === 'seeding'}
>
  <header class="ob-head">
    <h1>Welcome to Brain</h1>
    <p class="ob-sub">Set up your assistant from email.</p>
  </header>

  {#if state === 'not-started'}
    <section class="ob-card">
      <h2>Email</h2>
      {#if ripmailConfigured}
        <p class="ob-muted">Ripmail is configured. Continue to indexing.</p>
        <button
          type="button"
          class="ob-btn"
          onclick={() => {
            busy = true
            void patchState('indexing').finally(() => {
              busy = false
            })
          }}
          disabled={busy}
        >
          Continue
        </button>
      {:else}
        <p class="ob-muted">Connect Gmail (IMAP app password).</p>
        <label class="ob-label">Email<input class="ob-input" type="email" bind:value={email} autocomplete="email" /></label>
        <label class="ob-label">App password<input class="ob-input" type="password" bind:value={password} autocomplete="current-password" /></label>
        {#if setupError}
          <p class="ob-err">{setupError}</p>
        {/if}
        <button type="button" class="ob-btn" onclick={() => void setupRipmail()} disabled={busy || !email.trim() || !password}>
          {busy ? 'Connecting…' : 'Connect & continue'}
        </button>
      {/if}
    </section>
  {:else if state === 'indexing'}
    <section class="ob-card">
      <h2>Indexing</h2>
      <p class="ob-muted">Inbox messages visible: <strong>{inboxCount}</strong></p>
      <p class="ob-muted">Continue when enough mail is indexed (or try anyway).</p>
      <button type="button" class="ob-btn" onclick={() => void continueFromIndexing()} disabled={busy}>
        {busy ? '…' : 'Continue to profiling'}
      </button>
    </section>
  {:else if state === 'profiling'}
    <section class="ob-card ob-card-chat">
      <h2>Profile</h2>
      <p class="ob-muted">The agent reads your email and writes a draft profile — same chat experience as the main assistant.</p>
      <div class="ob-chat-host">
        <OnboardingAgentChat
          endpoint="/api/onboarding/profile"
          headerTitle="Profiling"
          emptyLead="You've connected your email — we'll turn it into your profile in this chat, the same Brain assistant you'll use every day."
          emptySub="No inbox or calendar previews here on purpose: this is onboarding. You'll see streaming replies, tools, and thinking below — starting automatically."
          autoSendMessage="Build a concise user profile from my email using tools. Write the result to profile-draft.md."
          onStreamFinished={async () => {
            await patchState('reviewing-profile')
          }}
        />
      </div>
    </section>
  {:else if state === 'reviewing-profile'}
    <section class="ob-card">
      <h2>Review profile</h2>
      <div class="ob-draft markdown">{@html renderMarkdown(draftMarkdown || '(loading)')}</div>
      <button type="button" class="ob-btn" onclick={() => void acceptProfile()} disabled={busy}>
        {busy ? '…' : 'Accept profile'}
      </button>
    </section>
  {:else if state === 'confirming-categories'}
    <section class="ob-card">
      <h2>Categories</h2>
      <p class="ob-muted">One category per line — used to scope wiki seeding.</p>
      <textarea class="ob-ta" rows="6" bind:value={categoriesText}></textarea>
      <button type="button" class="ob-btn" onclick={() => void prepareSeed()} disabled={busy}>
        {busy ? '…' : 'Prepare seeding'}
      </button>
    </section>
  {:else if state === 'seeding'}
    <section class="ob-card ob-card-chat">
      <h2>Building your wiki</h2>
      <p class="ob-muted">The agent creates pages from your profile and email — same streaming chat as Brain.</p>
      <div class="ob-chat-host">
        <OnboardingAgentChat
          endpoint="/api/onboarding/seed"
          headerTitle="Seeding"
          emptyLead="Next we'll seed your wiki — new pages and links from your profile and email."
          emptySub="Same chat as Brain: follow along as the assistant writes files and narrates. Starting automatically."
          autoSendMessage="Read wiki/me.md, then create useful wiki pages from the profile and email evidence. Narrate briefly as you go."
          onStreamFinished={afterSeedComplete}
        />
      </div>
    </section>
  {:else if state === 'done'}
    <section class="ob-card">
      <h2>Done</h2>
      <p class="ob-muted">Your wiki is ready. Opening the app…</p>
      <button type="button" class="ob-btn" onclick={() => void onComplete()}>Go to Brain</button>
    </section>
  {/if}
</div>

<style>
  .onboarding {
    min-height: 100%;
    padding: 1.25rem 1rem 3rem;
    max-width: 40rem;
    margin: 0 auto;
  }
  .onboarding-wide {
    max-width: min(960px, 100%);
  }
  .ob-card-chat {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .ob-chat-host {
    min-height: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .ob-head h1 {
    font-size: 1.35rem;
    font-weight: 600;
    margin: 0 0 0.35rem;
  }
  .ob-sub {
    color: var(--muted, #888);
    margin: 0 0 1.25rem;
    font-size: 0.9rem;
  }
  .ob-card {
    background: var(--surface, #1a1a1c);
    border: 1px solid var(--border, #333);
    border-radius: 10px;
    padding: 1rem 1.1rem;
  }
  .ob-card h2 {
    font-size: 1.05rem;
    margin: 0 0 0.75rem;
  }
  .ob-muted {
    color: var(--muted, #888);
    font-size: 0.88rem;
    margin: 0 0 0.75rem;
  }
  .ob-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    margin-bottom: 0.65rem;
  }
  .ob-input {
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    border: 1px solid var(--border, #333);
    background: var(--bg, #0f0f10);
    color: inherit;
  }
  .ob-ta {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    border: 1px solid var(--border, #333);
    background: var(--bg, #0f0f10);
    color: inherit;
    font-family: inherit;
    margin-bottom: 0.75rem;
    resize: vertical;
  }
  .ob-btn {
    margin-top: 0.5rem;
    padding: 0.55rem 1rem;
    border-radius: 8px;
    border: none;
    background: var(--accent, #3b82f6);
    color: #fff;
    font-weight: 500;
    cursor: pointer;
  }
  .ob-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .ob-err {
    color: #f87171;
    font-size: 0.85rem;
    margin: 0.25rem 0;
  }
  .ob-draft {
    font-size: 0.9rem;
    line-height: 1.45;
    max-height: 24rem;
    overflow: auto;
    margin: 0 0 0.75rem;
  }
</style>
