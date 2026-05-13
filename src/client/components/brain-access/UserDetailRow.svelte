<script lang="ts">
  import type { BrainAccessGrantRow } from '@client/lib/brainAccessPolicyGrouping.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    grant: BrainAccessGrantRow
    displayName?: string
    email?: string | null
    removeBusy?: boolean
    autoSendBusy?: boolean
    onRemove: () => void | Promise<void>
    onChangePolicy?: () => void
    onAutoSendChange?: (_autoSend: boolean) => void | Promise<void>
  }

  let {
    grant,
    displayName,
    email,
    removeBusy = false,
    autoSendBusy = false,
    onRemove,
    onChangePolicy,
    onAutoSendChange,
  }: Props = $props()

  const handle = $derived(grant.askerHandle ?? grant.askerId)
</script>

<div
  id={`grant-row-${grant.id}`}
  class="flex flex-col gap-2 border-b border-[color-mix(in_srgb,var(--border)_45%,transparent)] py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
>
  <div class="min-w-0 flex-1 flex flex-col gap-1">
    <div class="flex flex-wrap items-baseline gap-2">
      <span class="font-mono text-[0.9375rem] font-semibold text-foreground">@{handle}</span>
      {#if displayName?.trim()}
        <span class="text-[0.8125rem] text-muted">{displayName.trim()}</span>
      {/if}
    </div>
    <div class="text-[0.8125rem] text-muted">
      {#if email}
        {email}
      {:else}
        {$t('access.userDetailRow.noEmail')}
      {/if}
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-1">
      {#if onAutoSendChange}
        <label class="flex cursor-pointer items-center gap-2 text-[0.8125rem] font-medium text-foreground">
          <input
            type="checkbox"
            class="accent-accent"
            checked={grant.autoSend === true}
            disabled={autoSendBusy}
            onchange={(e) => void onAutoSendChange(e.currentTarget.checked)}
          />
          <span>{$t('access.userDetailRow.autoSendLabel')}</span>
        </label>
      {/if}
      {#if onChangePolicy}
        <button
          type="button"
          class="border-none bg-transparent p-0 text-[0.8125rem] font-semibold text-accent underline-offset-2 hover:underline"
          onclick={() => onChangePolicy()}
        >
          {$t('access.userDetailRow.actions.changePolicy')}
        </button>
      {/if}
    </div>
  </div>
  <button
    type="button"
    class="rounded-md border border-red-500/35 px-2 py-1 text-[0.75rem] font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
    disabled={removeBusy}
    aria-label={$t('access.userDetailRow.actions.removeAccessAria', { handle })}
    onclick={() => void onRemove()}
  >
    {removeBusy ? $t('access.userDetailRow.actions.removing') : $t('access.userDetailRow.actions.remove')}
  </button>
</div>
