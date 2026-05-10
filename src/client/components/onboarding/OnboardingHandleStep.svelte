<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { ArrowRight } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'
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
  let handleInputEl = $state<HTMLInputElement | undefined>()

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
      bootError = $t('onboarding.handleStep.errors.loadWorkspaceHandle')
    }
  }

  /** Browsers often reset focus late on full reload; retry across tasks / frames / `load`. */
  function scheduleFocusAttempts(
    getEl: () => HTMLInputElement | undefined,
    signal: AbortSignal,
  ): () => void {
    const run = () => {
      if (signal.aborted) return
      const el = getEl()
      if (!el || el.disabled) return
      el.focus({ preventScroll: true })
    }

    run()
    void tick().then(run)
    queueMicrotask(run)
    let rafInner: number | undefined
    const rafOuter = requestAnimationFrame(() => {
      rafInner = requestAnimationFrame(run)
    })
    const t = window.setTimeout(run, 0)

    let onLoad: (() => void) | undefined
    if (document.readyState !== 'complete') {
      onLoad = run
      window.addEventListener('load', onLoad, { once: true })
    }

    return () => {
      cancelAnimationFrame(rafOuter)
      if (rafInner !== undefined) cancelAnimationFrame(rafInner)
      window.clearTimeout(t)
      if (onLoad) window.removeEventListener('load', onLoad)
    }
  }

  onMount(() => {
    const ac = new AbortController()
    let stopFocusAttempts: (() => void) | null = null

    void (async () => {
      await boot()
      if (ac.signal.aborted) return
      await tick()
      await tick()
      if (ac.signal.aborted) return
      stopFocusAttempts = scheduleFocusAttempts(() => handleInputEl, ac.signal)
    })()

    return () => {
      ac.abort()
      stopFocusAttempts?.()
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
        availabilityHint = r.message ?? $t('onboarding.handleStep.errors.invalidHandle')
      } else if (!r.available && r.reason === 'taken') {
        availabilityHint = $t('onboarding.handleStep.errors.handleTaken')
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
          bootError = check.message ?? $t('onboarding.handleStep.errors.invalidHandle')
        } else if (check?.reason === 'taken') {
          bootError = $t('onboarding.handleStep.errors.handleTaken')
        } else {
          bootError = $t('onboarding.handleStep.errors.couldNotValidate')
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
    <span class="ob-kicker">{$t('onboarding.handleStep.kicker')}</span>
    <h1 class="ob-headline">{$t('onboarding.handleStep.title')}</h1>
    <p class="ob-lead">
      {$t('onboarding.handleStep.lead')}
    </p>

    {#if bootError}
      <p class="ob-error" role="alert">{bootError}</p>
    {/if}

    <div class="ob-handle-field mx-auto mt-5 w-full max-w-[22rem] text-left">
      <label
        class="ob-handle-label mb-1.5 block text-xs font-semibold tracking-wider text-[var(--muted)]"
        for="ob-handle-input"
      >
        {$t('onboarding.handleStep.handleLabel')}
      </label>
      <div
        class="ob-handle-input-row flex items-center gap-[0.15rem] border border-border bg-surface px-2.5 py-1.5"
      >
        <span
          class="ob-handle-at font-mono font-semibold text-[var(--muted)] select-none"
          aria-hidden="true"
        >
          @
        </span>
        <input
          id="ob-handle-input"
          bind:this={handleInputEl}
          type="text"
          class="ob-handle-input min-w-0 flex-1 border-none bg-transparent font-mono text-base text-[var(--text)] outline-none"
          autocomplete="username"
          spellcheck="false"
          bind:value={handleInput}
          oninput={() => {
            bootError = null
            queueAvailabilityCheck()
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter' && canSubmit) void confirm()
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
          {$t('onboarding.handleStep.checkingAvailability')}
        </p>
      {:else}
        <p
          class="ob-handle-hint ob-muted mt-[0.45rem] text-[0.8125rem] leading-snug text-[var(--muted)]"
        >
          {$t('onboarding.handleStep.rules')}
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
          {$t('onboarding.handleStep.saving')}
        {:else}
          {$t('onboarding.handleStep.confirmHandle')}
          <ArrowRight class="ob-btn-icon" size={16} strokeWidth={2} aria-hidden="true" />
        {/if}
      </button>
    </div>
  </OnboardingHeroShell>
</div>
