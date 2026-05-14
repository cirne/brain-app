<script lang="ts">
  import { t } from '@client/lib/i18n/index.js'
  import { cn } from '@client/lib/cn.js'
  import { formatRelativeDate } from '@client/lib/hub/hubRipmailSource.js'
  import type { B2BTunnelListRowApi } from '@client/lib/b2bTunnelTypes.js'
  import type { TunnelTimelinePendingReviewApi } from '@shared/tunnelTimeline.js'
  import TunnelPendingMessage from '@components/TunnelPendingMessage.svelte'
  import { Link2, Plus } from 'lucide-svelte'

  let {
    tunnels,
    pendingRows,
    loading,
    tunnelsError,
    reviewError,
    brainQueryEnabled,
    onPickTunnel,
    onOpenColdTunnelEntry,
    onRefresh,
  }: {
    tunnels: B2BTunnelListRowApi[]
    pendingRows: TunnelTimelinePendingReviewApi[]
    loading: boolean
    tunnelsError: string | null
    reviewError: string | null
    brainQueryEnabled: boolean
    onPickTunnel: (_handle: string) => void
    onOpenColdTunnelEntry?: (() => void) | undefined
    onRefresh: () => void | Promise<void>
  } = $props()

  function displayName(row: B2BTunnelListRowApi): string {
    const d = row.peerDisplayName?.trim()
    if (d) return d
    return row.peerHandle.trim() || $t('chat.messageRow.inboundRequesterFallback')
  }

  function policyBadge(row: B2BTunnelListRowApi): { label: string; class: string } {
    const p = row.inboundPolicy
    if (p === 'auto') {
      return {
        label: $t('chat.tunnels.list.policyAutosendShort'),
        class: 'bg-accent/15 text-accent',
      }
    }
    if (p === 'review') {
      return {
        label: $t('chat.tunnels.list.policyReviewShort'),
        class: 'bg-surface-3 text-muted',
      }
    }
    if (p === 'ignore') {
      return {
        label: $t('chat.tunnels.list.policyIgnoreShort'),
        class: 'bg-muted/20 text-muted',
      }
    }
    return { label: '', class: '' }
  }

  function lastActivityLabel(ms: number): string {
    if (!ms) return ''
    return formatRelativeDate(new Date(ms).toISOString())
  }
</script>

<div
  class="tunnels-list flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
  data-testid="tunnels-list"
>
  {#if loading}
    <p class="m-0 shrink-0 px-3 py-3 text-muted text-sm md:px-4">{$t('common.status.loading')}</p>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-4">
      {#if brainQueryEnabled && onOpenColdTunnelEntry}
        <div class="mb-4 flex shrink-0 justify-end">
          <button
            type="button"
            class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/80 px-3 py-2 text-sm font-medium hover:bg-surface-2"
            data-testid="tunnels-list-connect"
            onclick={() => onOpenColdTunnelEntry()}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            {$t('chat.history.coldQuery.button')}
          </button>
        </div>
      {/if}

      <section class="mb-6 min-w-0" aria-labelledby="tunnels-pending-heading">
        <h2
          id="tunnels-pending-heading"
          class="m-0 mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted"
        >
          {$t('chat.tunnels.list.pendingHeading')}
        </h2>
        {#if reviewError}
          <p class="m-0 mb-2 text-danger text-xs" role="alert">{reviewError}</p>
        {/if}
        {#if pendingRows.length === 0}
          <p class="m-0 text-muted text-sm">{$t('chat.tunnels.list.emptyPending')}</p>
        {:else}
          <div class="flex flex-col gap-3">
            {#each pendingRows as row (row.sessionId)}
              <div class="min-w-0 rounded-xl border border-border bg-surface-2/40 p-2 md:p-3">
                <TunnelPendingMessage row={row} onMutate={() => void onRefresh()} />
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <section class="min-w-0" aria-labelledby="tunnels-all-heading">
        <h2
          id="tunnels-all-heading"
          class="m-0 mb-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted"
        >
          {$t('chat.tunnels.list.allHeading')}
        </h2>
        {#if tunnelsError}
          <p class="m-0 mb-2 text-danger text-xs" role="alert">{tunnelsError}</p>
        {/if}
        {#if tunnels.length === 0}
          <p class="m-0 text-muted text-sm">{$t('chat.tunnels.list.emptyTunnels')}</p>
        {:else}
          <ul class="m-0 list-none space-y-1 p-0" data-testid="tunnels-list-all-rows">
            {#each tunnels as tun (tun.peerHandle)}
              {@const pb = policyBadge(tun)}
              {@const title = displayName(tun)}
              {@const handle = tun.peerHandle.trim()}
              {@const pendingN = tun.pendingReviewCount ?? 0}
              <li class="min-w-0">
                <button
                  type="button"
                  class={cn(
                    'flex w-full min-w-0 flex-col gap-1 rounded-lg border border-transparent px-2 py-2.5 text-left transition-colors',
                    'hover:border-border hover:bg-surface-2 md:flex-row md:items-start md:gap-3 md:py-2',
                  )}
                  aria-label={$t('chat.tunnels.list.openTunnelAria', { name: title })}
                  data-testid={`tunnels-list-row-${handle}`}
                  onclick={() => onPickTunnel(handle)}
                >
                  <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span class="truncate text-sm font-semibold text-foreground">{title}</span>
                    <span class="shrink-0 font-mono text-[0.7rem] text-muted">@{handle}</span>
                    {#if pb.label}
                      <span
                        class={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide',
                          pb.class,
                        )}>{pb.label}</span
                      >
                    {/if}
                    {#if pendingN > 0}
                      <span
                        class="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[0.65rem] font-semibold tabular-nums text-accent"
                        aria-label={$t('chat.tunnels.list.pendingBadge', { count: pendingN })}
                      >
                        {pendingN > 99 ? '99+' : pendingN}
                      </span>
                    {/if}
                  </div>
                  <div class="flex min-w-0 flex-col gap-0.5 md:flex-1 md:min-w-[12rem]">
                    {#if tun.snippet?.trim()}
                      <p class="m-0 line-clamp-2 text-[0.78rem] leading-snug text-muted">{tun.snippet.trim()}</p>
                    {/if}
                    {#if tun.lastActivityMs}
                      <p class="m-0 text-[0.65rem] text-muted/80">
                        {$t('chat.tunnels.list.lastActivity', { time: lastActivityLabel(tun.lastActivityMs) })}
                      </p>
                    {/if}
                  </div>
                  <span class="hidden shrink-0 text-muted md:inline-flex" aria-hidden="true">
                    <Link2 size={14} strokeWidth={2} />
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  {/if}
</div>
