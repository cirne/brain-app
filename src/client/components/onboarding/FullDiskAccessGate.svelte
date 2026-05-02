<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'
  import { invoke } from '@tauri-apps/api/core'
  import { exit, relaunch } from '@tauri-apps/plugin-process'
  import { isTauriRuntime } from '@client/lib/desktop/isTauriRuntime.js'

  let { children }: { children: Snippet } = $props()

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
    <div class="fda-modal">
      <OnboardingHeroShell>
        <span class="ob-kicker">Privacy</span>
        <h1 id="fda-title" class="ob-headline">Allow Full Disk Access</h1>
        <p class="ob-lead">
          macOS needs this permission so Braintunnel can read Mail, Messages, and your files on this Mac—what makes the
          assistant personal to you. <strong>That information stays on your Mac.</strong>
        </p>
        <ol class="fda-steps">
          <li>Click <strong>Open System Settings</strong> below.</li>
          <li>Turn on <strong>Braintunnel</strong> under Full Disk Access.</li>
          <li>Return here — we’ll detect the change and restart the app.</li>
        </ol>
        <div class="ob-cta-group">
          <button type="button" class="ob-btn-primary ob-btn-block" onclick={() => void onOpenSettings()}>
            Open System Settings
          </button>
          <button type="button" class="fda-btn-secondary" onclick={() => void onQuit()}>Quit</button>
        </div>
      </OnboardingHeroShell>
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
    display: flex;
    flex-direction: column;
    max-height: min(90vh, 720px);
    overflow-y: auto;
background: var(--bg, #0f0f0f);
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
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
  .fda-toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    padding: 0.65rem 1.25rem;
background: var(--bg-2, #1a1a1a);
    color: var(--text);
    font-size: 0.9rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  }
</style>
