<script lang="ts">
  import { onMount } from 'svelte'
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { t } from '@client/lib/i18n/index.js'
  import { cn } from '@client/lib/cn.js'
  import { formatRelativeDate } from '@client/lib/hub/hubRipmailSource.js'
  import type { B2BReviewRowApi } from '@client/lib/b2bReviewTypes.js'
  import ReviewDetail from '@components/ReviewDetail.svelte'
  import { ListChecks, MousePointerClick } from 'lucide-svelte'

  let {
    initialSessionId = null as string | null,
    onNavigateSession,
    onOpenInboundThread,
  }: {
    initialSessionId?: string | null
    onNavigateSession: (_sessionId: string | undefined) => void
    onOpenInboundThread: (_sessionId: string) => void
  } = $props()

  let rows = $state<B2BReviewRowApi[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  let selectedId = $state<string | null>(null)

  const selected = $derived(selectedId ? rows.find((r) => r.sessionId === selectedId) ?? null : null)

  async function load() {
    loading = true
    error = null
    try {
      const res = await apiFetch('/api/chat/b2b/review?state=all')
      if (!res.ok) {
        error = $t('chat.review.loadFailed')
        rows = []
        return
      }
      const j = (await res.json()) as { items?: unknown }
      const list = Array.isArray(j.items) ? j.items : []
      const next: B2BReviewRowApi[] = []
      for (const x of list) {
        if (!x || typeof x !== 'object') continue
        const o = x as Record<string, unknown>
        const sessionId = typeof o.sessionId === 'string' ? o.sessionId.trim() : ''
        if (!sessionId) continue
        next.push({
          sessionId,
          grantId: typeof o.grantId === 'string' ? o.grantId : '',
          peerHandle: typeof o.peerHandle === 'string' ? o.peerHandle : null,
          peerDisplayName: typeof o.peerDisplayName === 'string' ? o.peerDisplayName : null,
          askerSnippet: typeof o.askerSnippet === 'string' ? o.askerSnippet : '',
          draftSnippet: typeof o.draftSnippet === 'string' ? o.draftSnippet : '',
          state: typeof o.state === 'string' ? o.state : 'pending',
          updatedAtMs: typeof o.updatedAtMs === 'number' ? o.updatedAtMs : 0,
        })
      }
      rows = next
      if (selectedId && !rows.some((r) => r.sessionId === selectedId)) {
        selectedId = null
        onNavigateSession(undefined)
      }
    } catch {
      error = $t('chat.review.loadFailed')
      rows = []
    } finally {
      loading = false
    }
  }

  function stateLabel(state: string): string {
    if (state === 'pending') return $t('chat.review.row.state.pending')
    if (state === 'sent' || state === 'approved') return $t('chat.review.row.state.sent')
    if (state === 'auto') return $t('chat.review.row.state.auto')
    if (state === 'declined') return $t('chat.review.row.state.declined')
    return state
  }

  function pickRow(r: B2BReviewRowApi) {
    selectedId = r.sessionId
    onNavigateSession(r.sessionId)
  }

  async function inlineSend(e: Event, r: B2BReviewRowApi) {
    e.stopPropagation()
    if (r.state !== 'pending') return
    const res = await apiFetch('/api/chat/b2b/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: r.sessionId }),
    })
    if (res.ok) await load()
  }

  $effect(() => {
    const want = initialSessionId?.trim() ?? ''
    if (want && want !== selectedId) {
      selectedId = want
    }
  })

  onMount(() => {
    void load()
    const unsub = subscribe((ev) => {
      if (ev.type === 'b2b:review-changed') void load()
    })
    return () => unsub()
  })

  const rowBtn =
    'flex w-full cursor-pointer items-start gap-2 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--bg-3)_50%,transparent)] md:px-2'

  const queueEmpty = $derived(!loading && !error && rows.length === 0)
</script>

<div
  class="review-queue flex min-h-0 flex-1 flex-col md:flex-row md:divide-x md:divide-border"
  data-testid="review-queue"
>
  <div class="flex max-h-[40vh] min-h-0 flex-col border-b border-border md:max-h-none md:w-[min(100%,22rem)] md:border-b-0 md:border-e">
    <div class="shrink-0 border-b border-border px-3 py-2.5">
      <h1 class="m-0 text-[0.9375rem] font-bold tracking-tight">{$t('chat.review.nav.label')}</h1>
    </div>
    {#if loading}
      <p class="ch-muted px-3 py-2 text-xs text-muted">{$t('common.status.loading')}</p>
    {:else if error}
      <p class="px-3 py-2 text-danger text-xs">{error}</p>
    {:else if queueEmpty}
      <div
        class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-8 text-center md:py-10"
        data-testid="review-queue-empty-list"
      >
        <div
          class="relative flex size-[3.25rem] shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_14%,transparent)] ring-1 ring-border/55 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          aria-hidden="true"
        >
          <ListChecks class="size-7 text-accent opacity-[0.92]" strokeWidth={1.65} />
        </div>
        <div class="max-w-[16rem] md:max-w-[18rem]">
          <p class="m-0 text-sm font-semibold text-foreground">{$t('chat.review.emptyState.headline')}</p>
          <p class="m-0 mt-1.5 text-xs leading-snug text-muted">{$t('chat.review.emptyState.subhead')}</p>
        </div>
      </div>
    {:else}
      <ul class="m-0 max-h-[min(50vh,28rem)] list-none overflow-y-auto p-0 md:max-h-none md:flex-1" role="list">
        {#each rows as r (r.sessionId)}
          <li>
            <div
              role="button"
              tabindex="0"
              class={cn(rowBtn, selectedId === r.sessionId && 'bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]')}
              data-testid="review-queue-row"
              onclick={() => pickRow(r)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  pickRow(r)
                }
              }}
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="truncate text-[0.8125rem] font-semibold">
                    {r.peerHandle?.trim()
                      ? `@${r.peerHandle.trim().replace(/^@/, '')}`
                      : r.peerDisplayName?.trim() || '—'}
                  </span>
                  <span
                    class="shrink-0 rounded-full bg-surface-2 px-1.5 py-[1px] text-[0.65rem] font-semibold uppercase tracking-wide text-muted"
                  >
                    {stateLabel(r.state)}
                  </span>
                </div>
                <p class="m-0 mt-0.5 line-clamp-2 text-[0.75rem] text-muted">{r.askerSnippet || r.draftSnippet}</p>
                <p class="m-0 mt-1 text-[0.65rem] text-muted">
                  {r.updatedAtMs > 0 ? formatRelativeDate(new Date(r.updatedAtMs).toISOString()) : ''}
                </p>
              </div>
              {#if r.state === 'pending'}
                <button
                  type="button"
                  data-testid="review-row-send"
                  class="shrink-0 rounded-md bg-accent px-2 py-1 text-[0.7rem] font-semibold text-white hover:opacity-90"
                  onclick={(e) => void inlineSend(e, r)}
                >
                  {$t('chat.review.detail.actions.send')}
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    {#if selected}
      <ReviewDetail row={selected} {onOpenInboundThread} onMutate={() => void load()} />
    {:else if selectedId && loading}
      <div class="flex flex-1 items-center justify-center p-6 text-sm text-muted" role="status">
        {$t('common.status.loading')}
      </div>
    {:else if queueEmpty}
      <div
        class="relative flex min-h-[12rem] flex-1 flex-col items-center justify-center overflow-hidden p-6 md:min-h-0"
        data-testid="review-queue-empty-detail"
        role="region"
        aria-label={$t('chat.review.emptyState.detailTitle')}
      >
        <div class="pointer-events-none absolute inset-0 opacity-[0.38] dark:opacity-[0.22]" aria-hidden="true">
          <div
            class="absolute -start-10 top-[18%] size-[11rem] rounded-full bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] blur-3xl"
          ></div>
          <div
            class="absolute -end-12 bottom-[14%] size-[9rem] rounded-full bg-[color-mix(in_srgb,var(--accent)_11%,transparent)] blur-3xl"
          ></div>
          <div
            class="absolute start-1/3 top-1/2 size-[min(42vw,14rem)] -translate-y-1/2 rounded-full bg-[color-mix(in_srgb,var(--border)_35%,transparent)] blur-3xl dark:bg-[color-mix(in_srgb,var(--border)_22%,transparent)]"
          ></div>
        </div>
        <div class="relative z-[1] flex max-w-sm flex-col items-center text-center">
          <div
            class="mb-4 flex size-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--surface-2)_88%,var(--accent)_12%)] ring-1 ring-border/50 shadow-[0_12px_40px_-18px_color-mix(in_srgb,var(--accent)_45%,transparent)]"
            aria-hidden="true"
          >
            <ListChecks class="size-6 text-muted opacity-95" strokeWidth={1.6} />
          </div>
          <p class="m-0 text-[0.8125rem] font-semibold text-foreground">{$t('chat.review.emptyState.detailTitle')}</p>
          <p class="m-0 mt-2 text-sm leading-relaxed text-muted">{$t('chat.review.emptyState.detailBody')}</p>
        </div>
      </div>
    {:else}
      <div
        class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
        data-testid="review-queue-pick-detail"
      >
        <div
          class="flex size-11 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-border/60"
          aria-hidden="true"
        >
          <MousePointerClick class="size-5 text-muted" strokeWidth={1.65} />
        </div>
        <div class="max-w-xs">
          <p class="m-0 text-sm font-medium text-foreground">{$t('chat.review.emptyState.pickTitle')}</p>
          <p class="m-0 mt-1.5 text-sm leading-snug text-muted">{$t('chat.review.emptyState.pickHint')}</p>
        </div>
      </div>
    {/if}
  </div>
</div>
