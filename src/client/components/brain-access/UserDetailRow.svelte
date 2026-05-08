<script lang="ts">
  import type { BrainAccessGrantRow } from '@client/lib/brainAccessPolicyGrouping.js'

  type Props = {
    grant: BrainAccessGrantRow
    displayName?: string
    email?: string | null
    queryCount: number
    lastQueryMs: number | null
    removeBusy?: boolean
    onRemove: () => void | Promise<void>
    onViewActivity: () => void
    onChangePolicy?: () => void
  }

  let {
    grant,
    displayName,
    email,
    queryCount,
    lastQueryMs,
    removeBusy = false,
    onRemove,
    onViewActivity,
    onChangePolicy,
  }: Props = $props()

  function formatRelative(ms: number | null): string {
    if (ms == null) return '—'
    const diffSec = Math.floor((Date.now() - ms) / 1000)
    if (diffSec < 60) return 'Just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7) return `${diffD}d ago`
    return new Date(ms).toLocaleDateString()
  }

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
        No email on file
      {/if}
    </div>
    <div class="text-[0.8125rem] text-muted">
      {queryCount} quer{queryCount === 1 ? 'y' : 'ies'} · Last: {formatRelative(lastQueryMs)}
    </div>
    <div class="flex flex-wrap gap-x-3 gap-y-1">
      <button
        type="button"
        class="border-none bg-transparent p-0 text-[0.8125rem] font-semibold text-accent underline-offset-2 hover:underline"
        onclick={() => onViewActivity()}
      >
        View activity →
      </button>
      {#if onChangePolicy}
        <button
          type="button"
          class="border-none bg-transparent p-0 text-[0.8125rem] font-semibold text-accent underline-offset-2 hover:underline"
          onclick={() => onChangePolicy()}
        >
          Change policy…
        </button>
      {/if}
    </div>
  </div>
  <button
    type="button"
    class="rounded-md border border-red-500/35 px-2 py-1 text-[0.75rem] font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
    disabled={removeBusy}
    aria-label={`Remove access for @${handle}`}
    onclick={() => void onRemove()}
  >
    {removeBusy ? 'Removing…' : 'Remove'}
  </button>
</div>
