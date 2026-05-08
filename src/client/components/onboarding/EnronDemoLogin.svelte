<script lang="ts">
  import { onMount } from 'svelte'
  import { Mail } from 'lucide-svelte'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'

  type DemoUserOption = { key: string; label: string }

  let demoUsers = $state<DemoUserOption[]>([])
  let selectedDemoUser = $state('kean')
  let usersLoadError = $state<string | null>(null)

  let secret = $state('')
  let busy = $state(false)
  let errorMsg = $state<string | null>(null)

  function authHeader(): string {
    return `Bearer ${secret.trim()}`
  }

  async function loadDemoUsers(): Promise<void> {
    usersLoadError = null
    try {
      const res = await fetch('/api/auth/demo/enron/users', { cache: 'no-store' })
      if (!res.ok) {
        usersLoadError = `Could not load demo accounts (${res.status}).`
        return
      }
      const j = (await res.json()) as { users?: DemoUserOption[] }
      const list = j.users ?? []
      demoUsers = list
      if (list.length > 0 && !list.some(u => u.key === selectedDemoUser)) {
        selectedDemoUser = list[0]!.key
      }
    } catch {
      usersLoadError = 'Could not load demo accounts.'
    }
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    if (!secret.trim() || busy) return
    busy = true
    errorMsg = null
    try {
      const res = await fetch('/api/auth/demo/enron', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ demoUser: selectedDemoUser }),
      })
      if (res.status === 200) {
        window.location.href = '/c'
        return
      }
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      errorMsg = j.message ?? j.error ?? `Request failed (${res.status})`
    } finally {
      busy = false
    }
  }

  onMount(() => {
    void loadDemoUsers()
  })
</script>

<div class="box-border flex min-h-0 flex-1 flex-col items-center justify-center p-6 px-4">
  <OnboardingHeroShell>
    <!-- One column (22rem): same width as `.ob-vault-form` so hero + fields share one center line -->
    <div class="mx-auto w-full max-w-[22rem] text-center">
      <header class="ob-stacked-hero-lead" aria-labelledby="enron-demo-title">
        <div class="ob-stacked-hero-lead-icon" aria-hidden="true">
          <Mail size={20} strokeWidth={2} />
        </div>
        <span class="ob-kicker">Braintunnel demo</span>
        <h1 id="enron-demo-title" class="ob-headline">Test accounts: Enron</h1>
      </header>

      <form
        class="mt-6 flex w-full flex-col gap-3 text-center"
        onsubmit={onSubmit}
      >
        <fieldset class="flex flex-col gap-2 text-left" disabled={busy}>
          <legend class="sr-only">Demo mailbox</legend>
          {#if usersLoadError}
            <p class="text-xs text-danger">{usersLoadError}</p>
          {:else if demoUsers.length > 0}
            {#each demoUsers as u (u.key)}
              <label
                class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="demoUser"
                  value={u.key}
                  checked={selectedDemoUser === u.key}
                  onchange={() => {
                    selectedDemoUser = u.key
                  }}
                  class="shrink-0"
                />
                <span>{u.label}</span>
              </label>
            {/each}
          {:else}
            <p class="text-xs text-muted">Loading demo accounts…</p>
          {/if}
        </fieldset>

        <label class="sr-only" for="enron-demo-secret">Demo password</label>
        <input
          id="enron-demo-secret"
          name="secret"
          type="password"
          autocomplete="off"
          placeholder="Demo password"
          class="ob-input w-full"
          bind:value={secret}
          disabled={busy}
        />
        {#if errorMsg}
          <p class="text-sm text-danger">{errorMsg}</p>
        {/if}
        <button
          type="submit"
          class="ob-btn-primary w-full"
          disabled={busy || !secret.trim() || demoUsers.length === 0}
        >
          {busy ? 'Please wait…' : 'Continue'}
        </button>
      </form>

      <p class="ob-lead mt-4 text-xs text-muted">
        Pick a mailbox (Steven Kean, Kenneth Lay, or Jeff Skilling), then enter the shared demo password you were
        given. Demo mail must be pre-seeded on the server (<code
          class="rounded bg-muted px-1 py-0.5 font-mono text-[11px]"
          >npm run brain:seed-enron-demo:dev</code>). Data comes from the public Enron email dataset (roughly 1998–2001). For background, see
        <a
          href="https://www.cs.cmu.edu/~enron/"
          target="_blank"
          rel="noopener noreferrer"
          class="underline"
        >
          Carnegie Mellon’s Enron email dataset
        </a>
        .
      </p>
      <p class="ob-lead mt-6 text-xs text-muted">
        <a href="/" class="underline">Back to sign-in</a>
      </p>
    </div>
  </OnboardingHeroShell>
</div>
