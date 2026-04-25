<script lang="ts">
  import { Lock } from 'lucide-svelte'
  import { postVaultUnlock } from '@client/lib/vaultClient.js'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'

  interface Props {
    onUnlocked: () => void | Promise<void>
  }
  let { onUnlocked }: Props = $props()

  let password = $state('')
  let error = $state<string | null>(null)
  let busy = $state(false)

  async function submit() {
    error = null
    if (!password) {
      error = 'Enter your vault password.'
      return
    }
    busy = true
    try {
      const r = await postVaultUnlock(password)
      if ('error' in r) {
        error = r.error
        return
      }
      password = ''
      await onUnlocked()
    } finally {
      busy = false
    }
  }
</script>

<div class="unlock-shell">
  <OnboardingHeroShell>
    <header class="ob-stacked-hero-lead" aria-labelledby="unlock-vault-title">
      <div class="ob-stacked-hero-lead-icon" aria-hidden="true">
        <Lock size={20} strokeWidth={2} />
      </div>
      <span class="ob-kicker">Braintunnel</span>
      <h1 id="unlock-vault-title" class="ob-headline">Unlock your vault</h1>
      <p class="ob-lead">Enter your vault password to open Braintunnel in this browser.</p>
    </header>

    <form
      class="ob-vault-form"
      onsubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {#if error}
        <p class="ob-error" role="alert">{error}</p>
      {/if}
      <label class="ob-field">
        <span class="ob-field-label">Vault password</span>
        <input
          class="ob-input"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          disabled={busy}
          required
        />
      </label>
      <div class="ob-cta-group">
        <button type="submit" class="ob-btn-primary" disabled={busy}>
          {#if busy}
            <span class="ob-spinner" aria-hidden="true"></span>
            Unlocking…
          {:else}
            Unlock
          {/if}
        </button>
      </div>
    </form>
  </OnboardingHeroShell>
</div>

<style>
  .unlock-shell {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1.5rem 1rem;
    box-sizing: border-box;
  }
</style>
