<script lang="ts">
  import { onMount } from 'svelte'
  import Assistant from './lib/Assistant.svelte'
  import Onboarding from './lib/onboarding/Onboarding.svelte'
  import { parseRoute, type Route } from './router.js'
  import { clearOnboardingAgentLocalStorage } from './lib/onboarding/onboardingStorageKeys.js'

  let route = $state<Route>(parseRoute())
  let appReady = $state(false)
  let onboardingStatus = $state<{ state: string } | null>(null)

  async function fetchStatus() {
    try {
      const res = await fetch('/api/onboarding/status')
      const j = (await res.json()) as { state: string }
      onboardingStatus = { state: j.state }
    } catch {
      onboardingStatus = { state: 'not-started' }
    }
  }

  const showOnboarding = $derived(
    onboardingStatus != null &&
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
          if (res.ok) clearOnboardingAgentLocalStorage()
        } catch {
          /* ignore */
        }
        history.replaceState(null, '', '/onboarding')
        route = parseRoute()
      }
      await fetchStatus()
      appReady = true
    })()
    return () => window.removeEventListener('popstate', onPop)
  })

  async function onOnboardingComplete() {
    await fetchStatus()
    history.replaceState(null, '', '/')
    route = parseRoute()
  }
</script>

{#if !appReady}
  <div class="app-loading">Loading…</div>
{:else if showOnboarding}
  <div class="app-onboarding-shell h-full min-h-0">
    <Onboarding onComplete={onOnboardingComplete} refreshStatus={fetchStatus} />
  </div>
{:else}
  <Assistant />
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
