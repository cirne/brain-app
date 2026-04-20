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
    <header class="ob-local-wiki-lead" aria-labelledby="vault-setup-title">
      <div class="ob-local-wiki-lead-icon" aria-hidden="true">
        <Lock size={20} strokeWidth={2} />
      </div>
      <div class="ob-local-wiki-lead-text">
        <span class="ob-kicker">Brain Tunnel</span>
        <h1 id="vault-setup-title" class="ob-headline">Create your vault</h1>
        <p class="ob-lead">
          Brain Tunnel creates and maintains a personal vault on this Mac that learns from you over time—so your
          assistant can be completely personalized. Set a password to protect this vault; it isn’t your email password.
        </p>
      </div>
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

<style>
  .ob-vault-form {
    margin-top: 1.25rem;
    max-width: 22rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .ob-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    text-align: left;
  }

  .ob-field-label {
    font-size: 0.85rem;
    color: var(--muted, #888);
  }

  .ob-input {
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border, #333);
    background: var(--bg-2, #1a1a1a);
    color: var(--text, #eee);
    font-size: 1rem;
  }

  .ob-local-wiki-lead {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    margin-bottom: 0.25rem;
    text-align: left;
  }

  .ob-local-wiki-lead-icon {
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-3);
    border: 1px solid var(--border);
    color: var(--accent);
  }

  .ob-local-wiki-lead-text .ob-headline {
    margin: 0.35rem 0 0;
    font-size: 1.65rem;
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .ob-local-wiki-lead-text .ob-lead {
    margin: 0.75rem 0 0;
    line-height: 1.55;
    color: var(--muted);
    font-size: 0.98rem;
  }
</style>
