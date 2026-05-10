<script lang="ts">
  import { onMount } from 'svelte'
  import type { Snippet } from 'svelte'
  import { t } from '@client/lib/i18n/index.js'
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
  const restartToastLabel = $derived($t('onboarding.fullDiskAccess.toastPermissionGranted'))

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

  const showModal = $derived(gateApplies && checked && granted === false && !restarting)

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
      toast = restartToastLabel
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
  <div class="fda-loading p-8 text-center text-[0.95rem] text-muted">
    {$t('onboarding.fullDiskAccess.checkingPermissions')}
  </div>
{:else if showModal}
  <div
    class="fda-overlay fixed inset-0 z-[9999] flex items-center justify-center p-4 backdrop-blur-md bg-[color-mix(in_srgb,var(--bg)_88%,transparent)]"
    role="dialog"
    aria-modal="true"
    aria-labelledby="fda-title"
  >
    <div
      class="fda-modal flex max-h-[min(90vh,720px)] flex-col overflow-y-auto bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
    >
      <OnboardingHeroShell>
        <span class="ob-kicker">{$t('onboarding.fullDiskAccess.kicker')}</span>
        <h1 id="fda-title" class="ob-headline">
          {$t('onboarding.fullDiskAccess.title')}
        </h1>
        <p class="ob-lead">
          {$t('onboarding.fullDiskAccess.lead.beforeStrong')}
          <strong>{$t('onboarding.fullDiskAccess.lead.strong')}</strong>
        </p>
        <ol
          class="fda-steps mx-auto mt-5 max-w-[22rem] list-decimal pl-5 text-left text-[0.9375rem] leading-[1.55] text-muted"
        >
          <li>
            {$t('onboarding.fullDiskAccess.steps.openSettingsPrefix')}
            <strong>{$t('onboarding.fullDiskAccess.steps.openSettingsStrong')}</strong>
            {$t('onboarding.fullDiskAccess.steps.openSettingsSuffix')}
          </li>
          <li>
            {$t('onboarding.fullDiskAccess.steps.enableBraintunnelPrefix')}
            <strong>{$t('onboarding.fullDiskAccess.steps.enableBraintunnelStrong')}</strong>
            {$t('onboarding.fullDiskAccess.steps.enableBraintunnelSuffix')}
          </li>
          <li>{$t('onboarding.fullDiskAccess.steps.returnAndRestart')}</li>
        </ol>
        <div class="ob-cta-group">
          <button
            type="button"
            class="ob-btn-primary ob-btn-block"
            onclick={() => void onOpenSettings()}
          >
            {$t('onboarding.fullDiskAccess.openSystemSettings')}
          </button>
          <button
            type="button"
            class="fda-btn-secondary cursor-pointer border-none bg-transparent text-[0.9375rem] text-muted underline underline-offset-[3px] hover:text-foreground"
            onclick={() => void onQuit()}
          >
            {$t('onboarding.fullDiskAccess.quit')}
          </button>
        </div>
      </OnboardingHeroShell>
    </div>
  </div>
{:else}
  {@render children()}
{/if}
{#if toast}
  <div
    class="fda-toast fixed bottom-6 left-1/2 z-[10000] -translate-x-1/2 bg-surface-2 px-5 py-[0.65rem] text-[0.9rem] text-foreground shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
    role="status"
  >
    {toast}
  </div>
{/if}
