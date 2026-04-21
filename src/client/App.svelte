<script lang="ts">
  import { onMount } from 'svelte'
  import Assistant from './lib/Assistant.svelte'
  import FullDiskAccessGate from './lib/onboarding/FullDiskAccessGate.svelte'
  import Onboarding from './lib/onboarding/Onboarding.svelte'
  import UnlockVault from './lib/onboarding/UnlockVault.svelte'
  import HostedSignIn from './lib/onboarding/HostedSignIn.svelte'
  import { parseRoute, type Route } from './router.js'
  import { clearBrainClientStorage } from './lib/brainClientStorage.js'
  import { ONBOARDING_SEED_CHAT_STORAGE_KEY } from './lib/onboarding/onboardingStorageKeys.js'
  import { fetchVaultStatus, type VaultStatus } from './lib/vaultClient.js'
  import DesktopAppUpdate from './lib/desktop/DesktopAppUpdate.svelte'

  let route = $state<Route>(parseRoute())
  let appReady = $state(false)
  let onboardingStatus = $state<{ state: string } | null>(null)
  let vaultStatus = $state<(VaultStatus & { checked: boolean }) | null>(null)

  async function fetchVaultStatusSafe() {
    try {
      const v = await fetchVaultStatus()
      vaultStatus = { ...v, checked: true }
    } catch {
      vaultStatus = { vaultExists: false, unlocked: false, checked: true }
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch('/api/onboarding/status')
      const j = (await res.json()) as { state: string }
      onboardingStatus = { state: j.state }
    } catch {
      onboardingStatus = { state: 'not-started' }
    }
  }

  /** Vault + onboarding state together (vault gate drives `needsVaultSetup` / unlock UI). */
  async function refreshVaultAndOnboardingStatus() {
    await fetchVaultStatusSafe()
    await fetchStatus()
  }

  const showHostedSignIn = $derived(
    vaultStatus?.checked === true &&
      vaultStatus.multiTenant === true &&
      !vaultStatus.unlocked,
  )

  const showUnlockVault = $derived(
    vaultStatus?.checked &&
      vaultStatus.vaultExists &&
      !vaultStatus.unlocked &&
      vaultStatus.multiTenant !== true,
  )

  const needsVaultSetup = $derived(
    vaultStatus?.checked === true &&
      vaultStatus.vaultExists === false &&
      vaultStatus.multiTenant !== true,
  )

  const showOnboarding = $derived(
    onboardingStatus != null &&
      !showHostedSignIn &&
      !showUnlockVault &&
      (onboardingStatus.state !== 'done' || route.flow === 'onboarding'),
  )

  onMount(() => {
    const onPop = () => {
      route = parseRoute()
    }
    window.addEventListener('popstate', onPop)
    void (async () => {
      if (import.meta.env.DEV && parseRoute().flow === 'hard-reset') {
        try {
          const res = await fetch('/api/dev/hard-reset', { method: 'POST' })
          if (res.ok) clearBrainClientStorage()
        } catch {
          /* ignore */
        }
        history.replaceState(null, '', '/onboarding')
        route = parseRoute()
      }
      if (import.meta.env.DEV && parseRoute().flow === 'restart-seed') {
        try {
          const res = await fetch('/api/dev/restart-seed', { method: 'POST' })
          if (res.ok) {
            try {
              localStorage.removeItem(ONBOARDING_SEED_CHAT_STORAGE_KEY)
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
        history.replaceState(null, '', '/onboarding')
        route = parseRoute()
      }
      if (import.meta.env.DEV && parseRoute().flow === 'first-chat') {
        try {
          await fetch('/api/dev/first-chat', { method: 'POST' })
        } catch {
          /* ignore */
        }
        history.replaceState(null, '', '/')
        route = parseRoute()
      }
      await fetchVaultStatusSafe()
      await fetchStatus()
      appReady = true
    })()
    return () => window.removeEventListener('popstate', onPop)
  })

  async function onOnboardingComplete() {
    await fetchVaultStatusSafe()
    await fetchStatus()
    history.replaceState(null, '', '/')
    route = parseRoute()
  }
</script>

{#if !appReady}
  <div class="app-loading">Loading…</div>
{:else if showHostedSignIn}
  <div class="app-onboarding-shell h-full min-h-0">
    <HostedSignIn />
  </div>
{:else if showUnlockVault}
  <div class="app-onboarding-shell h-full min-h-0">
    <UnlockVault
      onUnlocked={async () => {
        await fetchVaultStatusSafe()
        await fetchStatus()
      }}
    />
  </div>
{:else}
  <FullDiskAccessGate>
    {#if showOnboarding}
      <div class="app-onboarding-shell h-full min-h-0">
        <Onboarding
          onComplete={onOnboardingComplete}
          refreshStatus={refreshVaultAndOnboardingStatus}
          needsVaultSetup={needsVaultSetup}
          multiTenant={vaultStatus?.multiTenant === true}
        />
      </div>
    {:else}
      <Assistant />
    {/if}
  </FullDiskAccessGate>
  <DesktopAppUpdate />
{/if}

<style>
  .app-loading {
    padding: 2rem;
    text-align: center;
    color: var(--muted, #888);
    font-size: 0.95rem;
  }
  .app-onboarding-shell {
    display: flex;
    flex-direction: column;
  }
</style>
