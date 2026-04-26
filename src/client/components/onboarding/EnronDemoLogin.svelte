<script lang="ts">
  import { onMount } from 'svelte'
  import { Mail } from 'lucide-svelte'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'

  type SeedPayload =
    | { status: 'ready' }
    | { status: 'running'; phase: string; startedAt: number }
    | { status: 'failed'; message: string; startedAt: number | null }
    | { status: 'idle' }

  let secret = $state('')
  let busy = $state(false)
  let errorMsg = $state<string | null>(null)
  let seeding = $state(false)
  let seedInfo = $state<SeedPayload | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null
  /** Bumps every 1s while seeding so elapsed / countdown re-render without waiting on network. */
  let seedUiTick = $state(0)
  /** Last successful `seed-status` response time (ms); drives “next check in …s”. */
  let lastPollOkAt = $state(0)
  let statusPollError = $state<string | null>(null)

  const POLL_MS = 5000

  $effect(() => {
    if (!seeding) {
      seedUiTick = 0
      return
    }
    const id = window.setInterval(() => {
      seedUiTick += 1
    }, 1000)
    return () => clearInterval(id)
  })

  const elapsedSec = $derived.by(() => {
    void seedUiTick
    if (seedInfo?.status !== 'running' || seedInfo.startedAt == null) return null
    return Math.max(0, Math.floor((Date.now() - seedInfo.startedAt) / 1000))
  })

  const nextCheckInSec = $derived.by(() => {
    void seedUiTick
    if (!lastPollOkAt) return Math.ceil(POLL_MS / 1000)
    return Math.max(0, Math.ceil((lastPollOkAt + POLL_MS - Date.now()) / 1000))
  })

  function authHeader(): string {
    return `Bearer ${secret.trim()}`
  }

  async function tryMint(): Promise<'ok' | 'seeding' | 'error'> {
    errorMsg = null
    const res = await fetch('/api/auth/demo/enron', {
      method: 'POST',
      cache: 'no-store',
      headers: { Authorization: authHeader() },
    })
    if (res.status === 200) {
      window.location.href = '/'
      return 'ok'
    }
    if (res.status === 202) {
      const j = (await res.json()) as { seed?: SeedPayload }
      seedInfo = j.seed ?? null
      if (j.seed?.status === 'failed') {
        errorMsg = j.seed.message
        return 'error'
      }
      return 'seeding'
    }
    const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
    errorMsg = j.message ?? j.error ?? `Request failed (${res.status})`
    return 'error'
  }

  async function pollSeedStatus() {
    try {
      const res = await fetch('/api/auth/demo/enron/seed-status', {
        cache: 'no-store',
        headers: { Authorization: authHeader() },
      })
      if (!res.ok) {
        statusPollError = `Status check failed (HTTP ${res.status}).`
        return
      }
      statusPollError = null
      lastPollOkAt = Date.now()
      const j = (await res.json()) as { seed?: SeedPayload }
      const snap = j.seed ?? null
      seedInfo = snap
      if (j.seed?.status === 'failed') {
        stopPoll()
        seeding = false
        errorMsg = j.seed.message
        return
      }
      if (j.seed?.status === 'ready') {
        stopPoll()
        busy = true
        const r = await tryMint()
        busy = false
        if (r === 'seeding') {
          seeding = true
          startPoll()
        }
      }
    } catch {
      /* ignore transient errors while seeding */
    }
  }

  function startPoll() {
    stopPoll()
    lastPollOkAt = 0
    void pollSeedStatus()
    pollTimer = setInterval(() => void pollSeedStatus(), POLL_MS)
  }

  function stopPoll() {
    if (pollTimer != null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    if (!secret.trim() || busy) return
    busy = true
    seeding = false
    seedInfo = null
    stopPoll()
    const r = await tryMint()
    busy = false
    if (r === 'seeding') {
      statusPollError = null
      seeding = true
      startPoll()
    }
  }

  onMount(() => {
    return () => stopPoll()
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
        <h1 id="enron-demo-title" class="ob-headline">Enron corpus login</h1>
      </header>

      {#if seeding}
        <div
          class="ob-lead mt-4 w-full border border-border px-4 py-3 text-center text-sm font-mono"
          aria-live="polite"
        >
          <p class="font-medium">Provisioning demo data…</p>
          {#if seedInfo?.status === 'running'}
            <p class="mt-2 text-muted-foreground">
              Phase: {seedInfo.phase} · started {new Date(seedInfo.startedAt).toLocaleTimeString()}
              {#if elapsedSec != null}
                · elapsed {elapsedSec}s
              {/if}
            </p>
          {:else if seedInfo?.status === 'failed'}
            <p class="mt-2 text-destructive">{seedInfo.message}</p>
          {:else}
            <p class="mt-2 text-muted-foreground">Starting…</p>
          {/if}
          {#if statusPollError}
            <p class="mt-2 text-xs text-destructive">{statusPollError}</p>
          {/if}
          <p class="mt-3 text-xs text-muted-foreground">
            Next status check in {nextCheckInSec}s (every {POLL_MS / 1000}s).
          </p>
        </div>
      {/if}

      <form
        class="mt-6 flex w-full flex-col gap-3 text-center"
        onsubmit={onSubmit}
      >
        <input
          id="enron-demo-secret"
          name="secret"
          type="password"
          autocomplete="off"
          class="ob-input w-full"
          bind:value={secret}
          disabled={busy || seeding}
        />
        {#if errorMsg}
          <p class="text-sm text-destructive">{errorMsg}</p>
        {/if}
        <button type="submit" class="ob-btn-primary w-full" disabled={busy || !secret.trim()}>
          {seeding ? 'Working…' : busy ? 'Please wait…' : 'Continue'}
        </button>
      </form>

      <p class="ob-lead mt-6 text-xs text-muted-foreground">
        <a href="/" class="underline">Back to sign-in</a>
      </p>
    </div>
  </OnboardingHeroShell>
</div>
