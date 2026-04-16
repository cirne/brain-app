<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { exit, relaunch } from '@tauri-apps/plugin-process'

  let { children }: { children: Snippet } = $props()

  function isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  }

  const gateApplies =
    typeof globalThis !== 'undefined' &&
    typeof window !== 'undefined' &&
    import.meta.env.PROD &&
    isTauriRuntime()

  let checked = $state(!gateApplies)
  let granted = $state<boolean | null>(!gateApplies ? true : null)
  let polling = $state(false)
  let restarting = $state(false)
  let toast = $state<string | null>(null)

  async function probeFda(): Promise<boolean> {
    if (isTauriRuntime()) {
      try {
        return await invoke<boolean>('check_fda')
      } catch {
        /* fall through to HTTP */
      }
    }
    try {
      const res = await fetch('/api/onboarding/fda')
      if (!res.ok) return false
      const j = (await res.json()) as { granted?: boolean }
      return j.granted === true
    } catch {
      return false
    }
  }

  const showModal = $derived(
    gateApplies && checked && granted === false && !restarting,
  )

  onMount(() => {
    if (!gateApplies) return

    void (async () => {
      granted = await probeFda()
      checked = true
    })()
  })

  $effect(() => {
    if (!polling || !gateApplies) return
    let cancelled = false
    const tick = async () => {
      const ok = await probeFda()
      if (cancelled || !ok) return
      polling = false
      toast = 'Permission granted — restarting…'
      restarting = true
      await new Promise((r) => setTimeout(r, 1000))
      try {
        await relaunch()
      } catch {
        restarting = false
        toast = null
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  })

  async function onOpenSettings() {
    try {
      await invoke('open_fda_settings')
    } catch {
      /* ignore */
    }
    polling = true
  }

  async function onQuit() {
    try {
      await exit(0)
    } catch {
      window.close()
    }
  }
</script>

{#if gateApplies && !checked}
  <div class="fda-loading">Checking permissions…</div>
{:else if showModal}
  <div class="fda-overlay" role="dialog" aria-modal="true" aria-labelledby="fda-title">
    <div class="fda-modal ob-hero">
      <div class="ob-hero-inner">
        <span class="ob-kicker">Privacy</span>
        <h1 id="fda-title" class="ob-headline">Brain needs Full Disk Access</h1>
        <p class="ob-lead">
          Brain reads local data (Mail, Messages, Notes) to power your assistant. macOS requires Full Disk Access for
          those folders.
        </p>
        <ol class="fda-steps">
          <li>Click <strong>Open System Settings</strong> below.</li>
          <li>Turn on <strong>Brain</strong> under Full Disk Access.</li>
          <li>Return here — we’ll detect the change and restart the app.</li>
        </ol>
        <div class="ob-cta-group">
          <button type="button" class="ob-btn-primary ob-btn-block" onclick={() => void onOpenSettings()}>
            Open System Settings
          </button>
          <button type="button" class="fda-btn-secondary" onclick={() => void onQuit()}>Quit</button>
        </div>
        <p class="ob-fine-print">
          <strong>Note:</strong> Privacy panes may look greyed out in screenshots — that does not mean access is off.
        </p>
      </div>
    </div>
  </div>
{:else}
  {@render children()}
{/if}
{#if toast}
  <div class="fda-toast" role="status">{toast}</div>
{/if}

<style>
  .fda-loading {
    padding: 2rem;
    text-align: center;
    color: var(--muted, #888);
    font-size: 0.95rem;
  }
  .fda-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--bg, #0a0a0a) 88%, transparent);
    backdrop-filter: blur(6px);
    padding: 1rem;
  }
  .fda-modal {
    max-height: min(90vh, 720px);
    overflow-y: auto;
    border-radius: 1rem;
    background: var(--bg, #0f0f0f);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  }
  .ob-hero {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-height: min(560px, 85vh);
    padding: 3.5rem 1.5rem;
  }
  @media (min-width: 640px) {
    .ob-hero {
      padding: 4rem 2rem;
    }
  }
  .ob-hero-inner {
    width: 100%;
    max-width: 28rem;
    text-align: center;
  }
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
    .ob-headline {
      font-size: 2.25rem;
    }
  }
  .ob-lead {
    margin-top: 1rem;
    font-size: 1.0625rem;
    line-height: 1.6;
    color: var(--text-2);
    text-wrap: pretty;
  }
  .fda-steps {
    margin: 1.25rem auto 0;
    padding-left: 1.25rem;
    max-width: 22rem;
    text-align: left;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--text-2);
  }
  .ob-cta-group {
    margin-top: 2.5rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }
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
    transition:
      background 0.15s,
      transform 0.1s,
      opacity 0.15s;
    -webkit-font-smoothing: antialiased;
  }
  .ob-btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }
  .ob-btn-primary:active:not(:disabled) {
    transform: scale(0.97);
  }
  .ob-btn-block {
    width: 100%;
  }
  .fda-btn-secondary {
    background: transparent;
    border: none;
    color: var(--text-2);
    font-size: 0.9375rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .fda-btn-secondary:hover {
    color: var(--text);
  }
  .ob-fine-print {
    margin-top: 1.5rem;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: color-mix(in srgb, var(--text-2) 70%, transparent);
    max-width: 22rem;
    margin-inline: auto;
  }
  .ob-fine-print strong {
    font-weight: 600;
    color: var(--text-2);
  }
  .fda-toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    padding: 0.65rem 1.25rem;
    border-radius: 0.5rem;
    background: var(--bg-2, #1a1a1a);
    color: var(--text);
    font-size: 0.9rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  }
</style>
