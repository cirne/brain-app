<script lang="ts">
  import { Lock } from 'lucide-svelte'
  import { postVaultSetup } from '../vaultClient.js'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'

  interface Props {
    onComplete: () => void | Promise<void>
  }
  let { onComplete }: Props = $props()

  const MIN_LEN = 8

  let password = $state('')
  let confirm = $state('')
  let error = $state<string | null>(null)
  let busy = $state(false)

  async function submit() {
    error = null
    if (password.length < MIN_LEN) {
      error = `Use at least ${MIN_LEN} characters.`
      return
    }
    if (password !== confirm) {
      error = 'Passwords do not match.'
      return
    }
    busy = true
    try {
      const r = await postVaultSetup(password, confirm)
      if ('error' in r) {
        error = r.error
        return
      }
      await onComplete()
    } finally {
      busy = false
    }
  }
</script>

<OnboardingHeroShell>
    <header class="ob-stacked-hero-lead" aria-labelledby="vault-setup-title">
      <div class="ob-stacked-hero-lead-icon" aria-hidden="true">
        <Lock size={20} strokeWidth={2} />
      </div>
      <span class="ob-kicker">Braintunnel</span>
      <h1 id="vault-setup-title" class="ob-headline">Create your vault</h1>
      <p class="ob-lead">
        Braintunnel creates and maintains a personal vault on this Mac that learns from you over time—so your
        assistant can be completely personalized. Set a password to protect this vault; it isn’t your email password.
      </p>
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
          autocomplete="new-password"
          bind:value={password}
          disabled={busy}
          required
          minlength={MIN_LEN}
        />
      </label>
      <label class="ob-field">
        <span class="ob-field-label">Confirm password</span>
        <input
          class="ob-input"
          type="password"
          autocomplete="new-password"
          bind:value={confirm}
          disabled={busy}
          required
          minlength={MIN_LEN}
        />
      </label>
      <div class="ob-cta-group">
        <button type="submit" class="ob-btn-primary" disabled={busy}>
          {#if busy}
            <span class="ob-spinner" aria-hidden="true"></span>
            Creating…
          {:else}
            Continue
          {/if}
        </button>
      </div>
    </form>
</OnboardingHeroShell>

