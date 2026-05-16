<script lang="ts">
  import { onMount } from 'svelte'
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { subscribeHubNotificationsRefresh, subscribeTunnelActivity } from '@client/lib/hubEvents/hubEventsClient.js'
  import { t } from '@client/lib/i18n/index.js'
  import { parseB2BTunnelListResponse, type B2BTunnelListRowApi } from '@client/lib/b2bTunnelTypes.js'
  import { parseB2BReviewListResponse, type B2BReviewRowApi } from '@client/lib/b2bReviewTypes.js'
  import type { TunnelTimelinePendingReviewApi } from '@shared/tunnelTimeline.js'
  import TunnelDetail from '@components/TunnelDetail.svelte'
  import TunnelsList from '@components/TunnelsList.svelte'

  let {
    routeTunnelHandle = null as string | null,
    onPickTunnelHandle,
    onOpenColdTunnelEntry,
  }: {
    routeTunnelHandle?: string | null
    onPickTunnelHandle: (_handle: string | undefined) => void
    onOpenColdTunnelEntry?: (() => void) | undefined
  } = $props()

  const activeHandle = $derived(routeTunnelHandle?.trim() ?? '')

  let tunnelsList = $state<B2BTunnelListRowApi[]>([])
  let pendingReviews = $state<TunnelTimelinePendingReviewApi[]>([])
  let listLoading = $state(false)
  let tunnelsListError = $state<string | null>(null)
  let reviewListError = $state<string | null>(null)

  let refreshSeq = 0

  function reviewRowToTunnelPending(r: B2BReviewRowApi): TunnelTimelinePendingReviewApi {
    return {
      kind: 'pending_review',
      id: `pend:${r.sessionId}`,
      atMs: r.updatedAtMs,
      sessionId: r.sessionId,
      grantId: r.grantId,
      isColdQuery: r.isColdQuery === true,
      policy: r.policy,
      peerHandle: r.peerHandle,
      peerDisplayName: r.peerDisplayName,
      askerSnippet: r.askerSnippet,
      draftSnippet: r.draftSnippet,
      state: r.state,
      updatedAtMs: r.updatedAtMs,
      expectsResponse: r.expectsResponse !== false,
    }
  }

  async function refreshTunnelIndex(opts?: { background?: boolean }): Promise<void> {
    if (activeHandle) return
    const bg = opts?.background ?? false
    const mySeq = ++refreshSeq
    if (!bg) {
      listLoading = true
      tunnelsListError = null
      reviewListError = null
    }
    try {
      const [tunnelRes, reviewRes] = await Promise.all([
        apiFetch('/api/chat/b2b/tunnels'),
        apiFetch('/api/chat/b2b/review?state=pending'),
      ])
      if (mySeq !== refreshSeq) return

      if (tunnelRes.ok) {
        const body = (await tunnelRes.json()) as unknown
        if (mySeq !== refreshSeq) return
        tunnelsList = parseB2BTunnelListResponse(body)
        tunnelsListError = null
      } else {
        tunnelsList = []
        if (tunnelRes.status !== 404) {
          tunnelsListError = $t('chat.tunnels.list.loadFailed')
        }
      }

      if (reviewRes.ok) {
        const body = (await reviewRes.json()) as unknown
        if (mySeq !== refreshSeq) return
        pendingReviews = parseB2BReviewListResponse(body).map(reviewRowToTunnelPending)
        reviewListError = null
      } else {
        pendingReviews = []
        if (reviewRes.status !== 404) {
          reviewListError = $t('chat.tunnels.list.reviewLoadFailed')
        }
      }
    } catch {
      if (mySeq !== refreshSeq) return
      if (!bg) {
        tunnelsList = []
        pendingReviews = []
        tunnelsListError = $t('chat.tunnels.list.loadFailed')
      }
    } finally {
      if (!bg) listLoading = false
    }
  }

  $effect(() => {
    void activeHandle
    if (!activeHandle) void refreshTunnelIndex()
  })

  onMount(() => {
    const unsubApp = subscribe((e) => {
      if (e.type === 'chat:sessions-changed' || e.type === 'b2b:review-changed') {
        void refreshTunnelIndex({ background: true })
      }
    })
    const unsubTunnel = subscribeTunnelActivity((p) => {
      if (p == null || p.scope === 'inbound' || p.scope === 'outbound' || p.scope === 'inbox') {
        void refreshTunnelIndex({ background: true })
      }
    })
    const unsubHub = subscribeHubNotificationsRefresh(() => {
      void refreshTunnelIndex({ background: true })
    })
    return () => {
      unsubApp()
      unsubTunnel()
      unsubHub()
    }
  })

  function pickTunnel(h: string) {
    const t = h.trim()
    if (!t) return
    onPickTunnelHandle(t)
  }
</script>

<!-- Index: summary list; detail: per-handle timeline + compose (rail still lists tunnels on desktop). -->
<div class="tunnels-shell flex min-h-0 min-w-0 flex-1 flex-col" data-testid="tunnels-shell">
  {#if activeHandle}
    <div class="min-h-0 flex-1 overflow-hidden">
      <TunnelDetail
        tunnelHandle={activeHandle}
        inboundGrantIdInitial={null}
        outboundGrantIdInitial={null}
        peerDisplayNameInitial=""
      />
    </div>
  {:else}
    <TunnelsList
      tunnels={tunnelsList}
      pendingRows={pendingReviews}
      loading={listLoading}
      tunnelsError={tunnelsListError}
      reviewError={reviewListError}
      onPickTunnel={pickTunnel}
      onOpenColdTunnelEntry={onOpenColdTunnelEntry}
      onRefresh={() => void refreshTunnelIndex({ background: true })}
    />
  {/if}
</div>
