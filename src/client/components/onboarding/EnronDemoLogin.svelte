<script lang="ts">
  import { onMount } from 'svelte'
  import { Mail } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'
  import OnboardingHeroShell from './OnboardingHeroShell.svelte'

  type DemoUserOption = { key: string; label: string }

  let demoUsers = $state<DemoUserOption[]>([])
  let selectedDemoUser = $state('kean')
  let usersLoadError = $state<string | null>(null)

  let secret = $state('')
  let busy = $state(false)
  let errorMsg = $state<string | null>(null)

  function authHeader(): string {
    return `Bearer ${secret.trim()}`
  }

  async function loadDemoUsers(): Promise<void> {
    usersLoadError = null
    try {
      const res = await fetch('/api/auth/demo/enron/users', { cache: 'no-store' })
      if (!res.ok) {
        usersLoadError = $t('onboarding.enronDemo.errors.loadAccountsWithStatus', {
          status: res.status,
        })
        return
      }
      const j = (await res.json()) as { users?: DemoUserOption[] }
      const list = j.users ?? []
      demoUsers = list
      if (list.length > 0 && !list.some(u => u.key === selectedDemoUser)) {
        selectedDemoUser = list[0]!.key
      }
    } catch {
      usersLoadError = $t('onboarding.enronDemo.errors.loadAccounts')
    }
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    if (!secret.trim() || busy) return
    busy = true
    errorMsg = null
    try {
      const res = await fetch('/api/auth/demo/enron', {
        method: 'POST',
        cache: 'no-store',
        headers: {
          Authorization: authHeader(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ demoUser: selectedDemoUser }),
      })
      if (res.status === 200) {
        window.location.href = '/c'
        return
      }
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      errorMsg =
        j.message ??
        j.error ??
        $t('onboarding.enronDemo.errors.requestFailedWithStatus', { status: res.status })
    } finally {
      busy = false
    }
  }

  onMount(() => {
    void loadDemoUsers()
  })
</script>

<div class="box-border flex min-h-0 flex-1 flex-col items-center justify-center p-6 px-4">
  <OnboardingHeroShell>
    <!-- One column (22rem): same width as `.ob-vault-form` so hero + fields share one center line -->
    <div class="mx-auto w-full max-w-[22rem] text-center">
      <header class="ob-stacked-hero-lead" aria-labelledby="enron-demo-title">
        <div class="ob-stacked-hero-lead-icon" aria-hidden="true">
          <Mail size={20} strokeWidth={2} />
        </div>
        <span class="ob-kicker">{$t('onboarding.enronDemo.kicker')}</span>
        <h1 id="enron-demo-title" class="ob-headline">{$t('onboarding.enronDemo.title')}</h1>
      </header>

      <form
        class="mt-6 flex w-full flex-col gap-3 text-center"
        onsubmit={onSubmit}
      >
        <fieldset class="flex flex-col gap-2 text-left" disabled={busy}>
          <legend class="sr-only">{$t('onboarding.enronDemo.demoMailboxLegend')}</legend>
          {#if usersLoadError}
            <p class="text-xs text-danger">{usersLoadError}</p>
          {:else if demoUsers.length > 0}
            {#each demoUsers as u (u.key)}
              <label
                class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <input
                  type="radio"
                  name="demoUser"
                  value={u.key}
                  checked={selectedDemoUser === u.key}
                  onchange={() => {
                    selectedDemoUser = u.key
                  }}
                  class="shrink-0"
                />
                <span>{u.label}</span>
              </label>
            {/each}
          {:else}
            <p class="text-xs text-muted">{$t('onboarding.enronDemo.loadingAccounts')}</p>
          {/if}
        </fieldset>

        <label class="sr-only" for="enron-demo-secret">
          {$t('onboarding.enronDemo.demoPasswordLabel')}
        </label>
        <input
          id="enron-demo-secret"
          name="secret"
          type="password"
          autocomplete="off"
          placeholder={$t('onboarding.enronDemo.demoPasswordPlaceholder')}
          class="ob-input w-full"
          bind:value={secret}
          disabled={busy}
        />
        {#if errorMsg}
          <p class="text-sm text-danger">{errorMsg}</p>
        {/if}
        <button
          type="submit"
          class="ob-btn-primary w-full"
          disabled={busy || !secret.trim() || demoUsers.length === 0}
        >
          {busy ? $t('onboarding.enronDemo.pleaseWait') : $t('onboarding.enronDemo.continue')}
        </button>
      </form>

      <p class="ob-lead mt-4 text-xs text-muted">
        {@html $t('onboarding.enronDemo.instructions')}
      </p>
    </div>
  </OnboardingHeroShell>
</div>
