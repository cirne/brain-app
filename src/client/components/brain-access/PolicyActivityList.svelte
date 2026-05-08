<script lang="ts">
  import type { BrainAccessLogRow } from '@client/lib/brainAccessPolicyGrouping.js'

  type Props = {
    entries: BrainAccessLogRow[]
    /** Max rows before showing overflow hint */
    limit?: number
    resolveAskerHandle?: (_askerId: string) => string | undefined
    showViewAll?: boolean
    onViewAll?: () => void
  }

  let {
    entries,
    limit = 10,
    resolveAskerHandle,
    showViewAll = false,
    onViewAll,
  }: Props = $props()

  function formatRelative(ms: number): string {
    const d = new Date(ms)
    if (isNaN(d.getTime())) return String(ms)
    const diffSec = Math.floor((Date.now() - ms) / 1000)
    if (diffSec < 60) return 'Just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7) return `${diffD}d ago`
    return d.toLocaleDateString()
  }

  function truncate(q: string, n: number): string {
    const t = q.trim()
    if (t.length <= n) return t
    return `${t.slice(0, n - 1)}…`
  }

  const visible = $derived(entries.slice(0, limit))
  const overflow = $derived(entries.length > limit)
</script>

{#if visible.length === 0}
  <p class="m-0 text-[0.8125rem] text-muted">No activity for this policy yet.</p>
{:else}
  <ul class="m-0 flex list-none flex-col gap-0 p-0">
    {#each visible as e (e.id)}
      <li
        class="border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)] py-2 text-[0.8125rem] last:border-b-0"
      >
        <div class="text-muted">
          <span class="font-medium text-foreground">{formatRelative(e.createdAtMs)}</span>
          {' '}·{' '}
          <span class="font-mono text-foreground"
            >@{resolveAskerHandle?.(e.askerId) ?? e.askerId}</span
          >
          {' '}·{' '}
          <span class="rounded-full bg-surface-3 px-1.5 py-px text-[0.625rem] font-bold uppercase tracking-wide">{e.status}</span>
        </div>
        <div class="mt-1 text-foreground">
          <strong>They asked:</strong>
          {truncate(e.question, 120)}
        </div>
      </li>
    {/each}
  </ul>
  {#if overflow && showViewAll && onViewAll}
    <button
      type="button"
      class="mt-2 border-none bg-transparent p-0 text-[0.8125rem] font-semibold text-accent underline-offset-2 hover:underline"
      onclick={() => onViewAll()}
    >
      View all activity ({entries.length}) →
    </button>
  {/if}
{/if}
