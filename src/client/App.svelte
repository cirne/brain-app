<script lang="ts">
  import { onMount } from 'svelte'
  import Assistant from '@components/Assistant.svelte'
  import FullDiskAccessGate from '@components/onboarding/FullDiskAccessGate.svelte'
  import Onboarding from '@components/onboarding/Onboarding.svelte'
  import UnlockVault from '@components/onboarding/UnlockVault.svelte'
  import HostedSignIn from '@components/onboarding/HostedSignIn.svelte'
  import EnronDemoLogin from '@components/onboarding/EnronDemoLogin.svelte'
  import { parseRoute, type Route } from './router.js'
  import { clearBrainClientStorage } from '@client/lib/brainClientStorage.js'
  import { ONBOARDING_SEED_CHAT_STORAGE_KEY } from '@client/lib/onboarding/onboardingStorageKeys.js'
  import { fetchVaultStatus, type VaultStatus } from '@client/lib/vaultClient.js'
  import DesktopAppUpdate from '@components/desktop/DesktopAppUpdate.svelte'

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

  const showEnronDemoPage = $derived(route.flow === 'enron-demo')

  const showHostedSignIn = $derived(
    vaultStatus?.checked === true &&
      vaultStatus.multiTenant === true &&
      !vaultStatus.unlocked &&
      !showEnronDemoPage,
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
      onboardingStatus.state !== 'done',
  )

  /** Already-onboarded users may land on `/onboarding` after sign-in; send them to the main app. */
  $effect(() => {
    if (!appReady || onboardingStatus == null || onboardingStatus.state !== 'done') return
    if (route.flow !== 'onboarding') return
    history.replaceState(null, '', '/')
    route = parseRoute()
  })

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
  <div class="p-8 text-center text-sm text-muted">Loading…</div>
{:else if showEnronDemoPage}
  <div class="flex h-full min-h-0 flex-col">
    <EnronDemoLogin />
  </div>
{:else if showHostedSignIn}
  <div class="flex h-full min-h-0 flex-col">
    <HostedSignIn />
  </div>
{:else if showUnlockVault}
  <div class="flex h-full min-h-0 flex-col">
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
      <div class="flex h-full min-h-0 flex-col">
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
