<script lang="ts">
  import { onMount } from 'svelte'
  import Assistant from '@components/Assistant.svelte'
  import FullDiskAccessGate from '@components/onboarding/FullDiskAccessGate.svelte'
  import HostedSignIn from '@components/onboarding/HostedSignIn.svelte'
  import EnronDemoLogin from '@components/onboarding/EnronDemoLogin.svelte'
  import { parseRoute, type Route } from './router.js'
  import { fetchVaultStatus, type VaultStatus } from '@client/lib/vaultClient.js'
  import { isReplayOnboardingWelcomeSearch } from '@client/lib/welcomeReplayDev.js'
  import DesktopAppUpdate from '@components/desktop/DesktopAppUpdate.svelte'

  let route = $state<Route>(parseRoute())
  /** DEV: prevents duplicate PATCH when replay-onboarding effect runs twice. */
  let replayOnboardingDevLock = false
  let appReady = $state(false)
  let onboardingStatus = $state<{ state: string } | null>(null)
  let vaultStatus = $state<(VaultStatus & { checked: boolean }) | null>(null)

  async function fetchVaultStatusSafe() {
    try {
      const v = await fetchVaultStatus()
      vaultStatus = { ...v, checked: true }
    } catch {
      vaultStatus = { unlocked: false, checked: true }
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

  async function refreshVaultAndOnboardingStatus() {
    await fetchVaultStatusSafe()
    await fetchStatus()
  }

  const showEnronDemoPage = $derived(route.flow === 'enron-demo')

  const showHostedSignIn = $derived(
    vaultStatus?.checked === true && !vaultStatus.unlocked && !showEnronDemoPage,
  )

  /** Already-onboarded users may land on `/welcome` after sign-in; send them to the main app. */
  $effect(() => {
    if (!appReady || onboardingStatus == null || onboardingStatus.state !== 'done') return
    if (route.flow !== 'welcome') return
    if (import.meta.env.DEV && typeof location !== 'undefined' && isReplayOnboardingWelcomeSearch(location.search)) {
      return
    }
    history.replaceState(null, '', '/c')
    route = parseRoute()
  })

  /**
   * DEV only: `/welcome?replay-onboarding=1` PATCH-resets onboarding machine state so the shell
   * shows again without deleting `./data`. Plain `/welcome` still redirects to `/c` when state is `done`.
   */
  $effect(() => {
    if (!import.meta.env.DEV || !appReady || route.flow !== 'welcome') return
    if (typeof location === 'undefined' || !isReplayOnboardingWelcomeSearch(location.search)) return
    if (replayOnboardingDevLock) return
    if (!vaultStatus?.checked || !vaultStatus.unlocked) return
    replayOnboardingDevLock = true
    void (async () => {
      try {
        const res = await fetch('/api/onboarding/state', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset' }),
        })
        if (!res.ok) {
          replayOnboardingDevLock = false
          return
        }
        /** Refresh before stripping query so redirect $effect never sees `done` on `/welcome` without the replay param. */
        await refreshVaultAndOnboardingStatus()
        history.replaceState(null, '', '/welcome')
        route = parseRoute()
      } catch {
        /* leave query in URL so dev can retry */
      } finally {
        replayOnboardingDevLock = false
      }
    })()
  })

  onMount(() => {
    const onPop = () => {
      route = parseRoute()
    }
    window.addEventListener('popstate', onPop)
    void (async () => {
      await fetchVaultStatusSafe()
      await fetchStatus()
      appReady = true
    })()
    return () => window.removeEventListener('popstate', onPop)
  })
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
{:else}
  <FullDiskAccessGate>
    <Assistant
      brainQueryEnabled={vaultStatus?.brainQueryEnabled ?? false}
      refreshAppOnboardingStatus={refreshVaultAndOnboardingStatus}
      multiTenant={vaultStatus?.multiTenant === true}
    />
  </FullDiskAccessGate>
  <DesktopAppUpdate />
{/if}
