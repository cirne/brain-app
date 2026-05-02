<script lang="ts">
  import { onMount } from 'svelte'
  import { ArrowRight } from 'lucide-svelte'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'
  import {
    fetchAccountHandle,
    checkHandleAvailability,
    postConfirmHandle,
  } from '@client/lib/accountClient.js'

  interface Props {
    /** Refreshes vault + onboarding GET /status after confirm. */
    refreshStatus: () => Promise<void>
    /** Reload local onboarding mail/state after confirm. */
    onComplete: () => Promise<void>
  }

  let { refreshStatus, onComplete }: Props = $props()

  let handleInput = $state('')
  let busy = $state(false)
  let bootError = $state<string | null>(null)
  let availabilityHint = $state<string | null>(null)
  let checking = $state(false)
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  /** `handle-meta` may temporarily mirror the tenant `usr_…` directory id — never pre-fill that. */
  function isPlaceholderWorkspaceHandle(handle: string, userId: string | undefined): boolean {
    if (userId && handle === userId) return true
    return /^usr_[a-z0-9]{20}$/.test(handle)
  }

  async function boot() {
    bootError = null
    try {
      const meta = await fetchAccountHandle()
      if (meta) {
        if (isPlaceholderWorkspaceHandle(meta.handle, meta.userId)) {
          handleInput = meta.suggestedHandle?.trim() ?? ''
        } else {
          handleInput = meta.handle
        }
      }
      queueAvailabilityCheck()
    } catch {
      bootError = 'Could not load your workspace handle. Try reloading the page.'
    }
  }

  onMount(() => {
    void boot()
    return () => {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    }
  })

  function queueAvailabilityCheck() {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    availabilityHint = null
    checking = true
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      void runAvailabilityCheck()
    }, 300)
  }

  async function runAvailabilityCheck() {
    const raw = handleInput.trim()
    checking = false
    if (!raw) {
      availabilityHint = null
      return
    }
    try {
      const r = await checkHandleAvailability(raw)
      if (!r) {
        availabilityHint = null
        return
      }
      if (!r.available && r.reason === 'invalid') {
        availabilityHint = r.message ?? 'Invalid handle.'
      } else if (!r.available && r.reason === 'taken') {
        availabilityHint = 'That handle is taken. Try another.'
      } else {
        availabilityHint = null
      }
    } catch {
      availabilityHint = null
    }
  }

  async function confirm() {
    bootError = null
    busy = true
    try {
      const raw = handleInput.trim()
      const check = await checkHandleAvailability(raw)
      if (!check?.available) {
        if (check?.reason === 'invalid') {
          bootError = check.message ?? 'Invalid handle.'
        } else if (check?.reason === 'taken') {
          bootError = 'That handle is taken. Try another.'
        } else {
          bootError = 'Could not validate handle. Try again.'
        }
        return
      }
      const r = await postConfirmHandle(raw)
      if ('error' in r) {
        bootError = r.error
        return
      }
      await refreshStatus()
      await onComplete()
    } finally {
      busy = false
    }
  }

  const canSubmit = $derived.by(() => {
    const raw = handleInput.trim()
    return raw.length >= 3 && !busy
  })
</script>

<div
  class="onboarding onboarding-wide flex h-full min-h-0 w-full flex-col bg-[var(--bg)] text-[var(--text)]"
>
  <OnboardingHeroShell>
    <span class="ob-kicker">Braintunnel</span>
    <h1 class="ob-headline">Choose your handle</h1>
    <p class="ob-lead">
      This is how other Braintunnel users will find and connect with you. Your account has a stable id behind the scenes, so changing this handle later will be possible when we ship that flow.
    </p>

    {#if bootError}
      <p class="ob-error" role="alert">{bootError}</p>
    {/if}

    <div class="ob-handle-field mx-auto mt-5 w-full max-w-[22rem] text-left">
      <label
        class="ob-handle-label mb-1.5 block text-xs font-semibold tracking-wider text-[var(--muted)]"
        for="ob-handle-input"
      >
        Handle
      </label>
      <div
        class="ob-handle-input-row flex items-center gap-[0.15rem] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5"
      >
        <span
          class="ob-handle-at font-mono font-semibold text-[var(--muted)] select-none"
          aria-hidden="true"
        >
          @
        </span>
        <input
          id="ob-handle-input"
          type="text"
          class="ob-handle-input min-w-0 flex-1 border-none bg-transparent font-mono text-base text-[var(--text)] outline-none"
          autocomplete="username"
          spellcheck="false"
          bind:value={handleInput}
          oninput={() => {
            bootError = null
            queueAvailabilityCheck()
          }}
          disabled={busy}
          maxlength="32"
        />
      </div>
      {#if availabilityHint}
        <p class="ob-handle-hint ob-error mt-[0.45rem] text-[0.8125rem] leading-snug" role="status">
          {availabilityHint}
        </p>
      {:else if checking}
        <p
          class="ob-handle-hint ob-muted mt-[0.45rem] text-[0.8125rem] leading-snug text-[var(--muted)]"
        >
          Checking availability…
        </p>
      {:else}
        <p
          class="ob-handle-hint ob-muted mt-[0.45rem] text-[0.8125rem] leading-snug text-[var(--muted)]"
        >
          Lowercase letters, numbers, hyphens. 3–32 characters.
        </p>
      {/if}
    </div>

    <div class="ob-cta-group">
      <button
        type="button"
        class="ob-btn-primary"
        onclick={() => void confirm()}
        disabled={!canSubmit}
      >
        {#if busy}
          <span class="ob-spinner" aria-hidden="true"></span>
          Saving…
        {:else}
          Confirm handle
          <ArrowRight class="ob-btn-icon" size={16} strokeWidth={2} aria-hidden="true" />
        {/if}
      </button>
    </div>
  </OnboardingHeroShell>
</div>
