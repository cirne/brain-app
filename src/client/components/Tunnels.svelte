<script lang="ts">
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { t } from '@client/lib/i18n/index.js'
  import TunnelDetail from '@components/TunnelDetail.svelte'
  import { ArrowLeft, Plus } from 'lucide-svelte'

  let {
    routeTunnelHandle = null as string | null,
    legacyInboundSessionId = null as string | null,
    brainQueryEnabled = false,
    onPickTunnelHandle,
    onReplaceLegacyReviewRoute,
    onOpenOutboundChat,
    onOpenColdTunnelEntry,
  }: {
    routeTunnelHandle?: string | null
    legacyInboundSessionId?: string | null
    brainQueryEnabled?: boolean
    onPickTunnelHandle: (_handle: string | undefined) => void
    /** After resolving `/review/:sid` deep link → `/tunnels/:handle`; clears stale `reviewSessionId` in Route. */
    onReplaceLegacyReviewRoute?: ((_handle: string) => void) | undefined
    onOpenOutboundChat: (_sessionId: string, _titleHint?: string) => void
    onOpenColdTunnelEntry?: (() => void) | undefined
  } = $props()

  /** Guard repeated legacy resolution for the same session id. */
  let legacyResolvedSession = $state<string | null>(null)

  const activeHandle = $derived(routeTunnelHandle?.trim() ?? '')

  /** Legacy `/review/:sid` → resolve collaborator handle → canonical tunnels route (clears inbound id). */
  $effect(() => {
    const sid = legacyInboundSessionId?.trim()
    if (!sid) {
      legacyResolvedSession = null
      return
    }
    if (legacyResolvedSession === sid) return

    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch(`/api/chat/b2b/peer-handle-for-review/${encodeURIComponent(sid)}`)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { tunnelHandle?: unknown }
        const h = typeof j.tunnelHandle === 'string' ? j.tunnelHandle.trim() : ''
        if (!h || cancelled) return
        legacyResolvedSession = sid
        onReplaceLegacyReviewRoute?.(h)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  })

  function backToTunnelsIndex() {
    onPickTunnelHandle(undefined)
  }
</script>

<!-- Tunnels list lives in the history rail; primary is detail or empty state only. -->
<div class="tunnels-shell flex min-h-0 min-w-0 flex-1 flex-col" data-testid="tunnels-shell">
  {#if activeHandle}
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2 md:hidden">
      <button
        type="button"
        class="inline-flex items-center rounded-lg border border-border p-2"
        onclick={backToTunnelsIndex}
        aria-label={$t('common.actions.back')}
      >
        <ArrowLeft class="size-5" strokeWidth={1.75} />
      </button>
      <span class="min-w-0 flex-1 truncate text-sm font-semibold">@{activeHandle}</span>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden">
      <TunnelDetail
        tunnelHandle={activeHandle}
        inboundGrantIdInitial={null}
        outboundGrantIdInitial={null}
        peerDisplayNameInitial=""
        onOpenOutboundChat={onOpenOutboundChat}
      />
    </div>
  {:else}
    <div
      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-8 pt-4 text-center"
      data-testid="tunnels-empty"
    >
      <p class="m-0 max-w-sm text-muted text-sm">{$t('chat.tunnels.pickPrompt')}</p>
      {#if brainQueryEnabled && onOpenColdTunnelEntry}
        <button
          type="button"
          class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/80 px-4 py-2.5 text-sm"
          onclick={() => onOpenColdTunnelEntry()}
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" />
          {$t('chat.history.coldQuery.button')}
        </button>
      {/if}
    </div>
  {/if}
</div>
