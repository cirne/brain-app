<script lang="ts">
  import { onMount } from 'svelte'
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { t } from '@client/lib/i18n/index.js'
  import { cn } from '@client/lib/cn.js'
  import { formatRelativeDate } from '@client/lib/hub/hubRipmailSource.js'
  import { parseB2BReviewListResponse, type B2BReviewRowApi } from '@client/lib/b2bReviewTypes.js'
  import ReviewDetail from '@components/ReviewDetail.svelte'
  import { ChevronLeft, ChevronRight, ListChecks, MousePointerClick } from '@lucide/svelte'

  /** Inset width below this uses single-pane + queue header (mobile / rail-open squeeze). */
  const REVIEW_SPLIT_MIN_PX = 720

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
  /** Set before load() when triggered by an approve/dismiss action to drive auto-advance. */
  let wantAdvance = false

  let layoutRoot = $state<HTMLDivElement | null>(null)
  /** Driven by `layoutRoot` width (ResizeObserver); false when width unknown or wide enough for split. */
  let compact = $state(false)

  const selected = $derived(selectedId ? rows.find((r) => r.sessionId === selectedId) ?? null : null)
  const queueEmpty = $derived(!loading && !error && rows.length === 0)
  const rowIndex = $derived(selectedId ? rows.findIndex((r) => r.sessionId === selectedId) : -1)

  function syncCompactFromWidth(w: number) {
    compact = w > 0 && w < REVIEW_SPLIT_MIN_PX
  }

  $effect(() => {
    const el = layoutRoot
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? el.getBoundingClientRect().width
      syncCompactFromWidth(w)
    })
    ro.observe(el)
    syncCompactFromWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  })

  async function load() {
    const shouldAdvance = wantAdvance
    wantAdvance = false
    loading = true
    error = null
    try {
      const res = await apiFetch('/api/chat/b2b/review?state=pending')
      if (!res.ok) {
        error = $t('chat.review.loadFailed')
        rows = []
        return
      }
      const j = (await res.json()) as unknown
      rows = parseB2BReviewListResponse(j)

      const want = initialSessionId?.trim() ?? ''
      if (want && rows.some((r) => r.sessionId === want)) {
        selectedId = want
        onNavigateSession(want)
      } else if (shouldAdvance && selectedId) {
        // Auto-advance after approve/dismiss: move to the next pending row.
        const currentRow = rows.find((r) => r.sessionId === selectedId)
        if (!currentRow || currentRow.state !== 'pending') {
          const nextPending = rows.find((r) => r.state === 'pending')
          if (nextPending) {
            selectedId = nextPending.sessionId
            onNavigateSession(nextPending.sessionId)
          } else if (!currentRow) {
            selectedId = null
            onNavigateSession(undefined)
          }
        }
      } else {
        if (selectedId && !rows.some((r) => r.sessionId === selectedId)) {
          selectedId = null
          onNavigateSession(undefined)
        }
        if (!selectedId && rows.length > 0) {
          const first = rows.find((r) => r.state === 'pending') ?? rows[0]
          selectedId = first.sessionId
          onNavigateSession(first.sessionId)
        }
      }
    } catch {
      error = $t('chat.review.loadFailed')
      rows = []
    } finally {
      loading = false
    }
  }

  /** Called by ReviewDetail after a successful approve or dismiss to reload and auto-advance. */
  async function loadAndAdvance() {
    wantAdvance = true
    await load()
  }

  function stateLabel(state: string): string {
    if (state === 'pending') return $t('chat.review.row.state.pending')
    if (state === 'sent' || state === 'approved') return $t('chat.review.row.state.sent')
    if (state === 'auto') return $t('chat.review.row.state.auto')
    if (state === 'declined') return $t('chat.review.row.state.declined')
    if (state === 'dismissed') return $t('chat.review.row.state.dismissed')
    return state
  }

  function pickRow(r: B2BReviewRowApi) {
    selectedId = r.sessionId
    onNavigateSession(r.sessionId)
  }

  function rowPrimaryLabel(r: B2BReviewRowApi): string {
    return r.peerHandle?.trim()
      ? `@${r.peerHandle.trim().replace(/^@/, '')}`
      : r.peerDisplayName?.trim() || '—'
  }

  function goPrev() {
    if (rowIndex <= 0) return
    pickRow(rows[rowIndex - 1]!)
  }

  function goNext() {
    if (rowIndex < 0 || rowIndex >= rows.length - 1) return
    pickRow(rows[rowIndex + 1]!)
  }

  function onJumpSelectChange(ev: Event) {
    const el = ev.currentTarget as HTMLSelectElement
    const id = el.value?.trim()
    if (!id) return
    const r = rows.find((x) => x.sessionId === id)
    if (r) pickRow(r)
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

  const iconBtn =
    'inline-flex shrink-0 items-center justify-center rounded-lg border border-border p-1.5 text-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--bg-3)_50%,transparent)] disabled:pointer-events-none disabled:opacity-35'
</script>

<div
  bind:this={layoutRoot}
  class="review-queue-root flex min-h-0 min-w-0 flex-1 flex-col"
  data-testid="review-queue"
>
  {#if compact}
    {#if loading && rows.length === 0}
      <p class="ch-muted px-3 py-3 text-xs text-muted">{$t('common.status.loading')}</p>
    {:else if error}
      <p class="px-3 py-3 text-danger text-xs">{error}</p>
    {:else if queueEmpty}
      <div
        class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center"
        data-testid="review-queue-empty-compact"
      >
        <div
          class="relative flex size-[3.25rem] shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_14%,transparent)] ring-1 ring-border/55 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          aria-hidden="true"
        >
          <ListChecks class="size-7 text-accent opacity-[0.92]" strokeWidth={1.65} />
        </div>
        <div class="max-w-[20rem]">
          <p class="m-0 text-sm font-semibold text-foreground">{$t('chat.review.emptyState.compactHeadline')}</p>
          <p class="m-0 mt-1.5 text-xs leading-snug text-muted">{$t('chat.review.emptyState.compactSubhead')}</p>
        </div>
      </div>
    {:else}
      <div
        class="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
      >
        <h1 class="m-0 text-[0.9375rem] font-bold tracking-tight">{$t('chat.review.nav.label')}</h1>
        <div class="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            class={iconBtn}
            aria-label={$t('chat.review.queue.prevLabel')}
            disabled={rowIndex <= 0}
            onclick={goPrev}
          >
            <ChevronLeft class="size-5" strokeWidth={1.75} />
          </button>
          <span class="min-w-[3.25rem] shrink-0 text-center text-[0.6875rem] font-medium tabular-nums text-muted">
            {#if rowIndex >= 0}
              {$t('chat.review.queue.position', { current: rowIndex + 1, total: rows.length })}
            {/if}
          </span>
          <button
            type="button"
            class={iconBtn}
            aria-label={$t('chat.review.queue.nextLabel')}
            disabled={rowIndex < 0 || rowIndex >= rows.length - 1}
            onclick={goNext}
          >
            <ChevronRight class="size-5" strokeWidth={1.75} />
          </button>
          {#if rows.length > 1}
            <label class="sr-only" for="review-queue-jump">{$t('chat.review.queue.jumpTo')}</label>
            <select
              id="review-queue-jump"
              class="max-w-[min(100%,12rem)] shrink rounded-lg border border-border bg-surface-3 px-2 py-1.5 text-[0.6875rem] text-foreground focus:border-accent focus:outline-none"
              onchange={onJumpSelectChange}
            >
              {#each rows as r (r.sessionId)}
                <option value={r.sessionId} selected={r.sessionId === selectedId}>
                  {rowPrimaryLabel(r)}
                  {r.askerSnippet || r.draftSnippet
                    ? ` · ${(r.askerSnippet || r.draftSnippet).slice(0, 48)}`
                    : ''}
                </option>
              {/each}
            </select>
          {/if}
        </div>
      </div>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        {#if selected}
          <ReviewDetail row={selected} {onOpenInboundThread} onMutate={() => void loadAndAdvance()} />
        {:else if selectedId && loading}
          <div class="flex flex-1 items-center justify-center p-6 text-sm text-muted" role="status">
            {$t('common.status.loading')}
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
    {/if}
  {:else}
    <div
      class="review-queue flex min-h-0 min-w-0 flex-1 flex-row divide-x divide-border"
      data-testid="review-queue-split"
    >
      <div class="flex min-h-0 w-[min(100%,22rem)] shrink-0 flex-col overflow-hidden border-e border-border">
        <div class="shrink-0 border-b border-border px-3 py-2.5">
          <h1 class="m-0 text-[0.9375rem] font-bold tracking-tight">{$t('chat.review.nav.label')}</h1>
        </div>
        {#if loading}
          <p class="ch-muted px-3 py-2 text-xs text-muted">{$t('common.status.loading')}</p>
        {:else if error}
          <p class="px-3 py-2 text-danger text-xs">{error}</p>
        {:else if queueEmpty}
          <div
            class="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center"
            data-testid="review-queue-empty-list"
          >
            <div
              class="relative flex size-[3.25rem] shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_14%,transparent)] ring-1 ring-border/55 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              aria-hidden="true"
            >
              <ListChecks class="size-7 text-accent opacity-[0.92]" strokeWidth={1.65} />
            </div>
            <div class="max-w-[18rem]">
              <p class="m-0 text-sm font-semibold text-foreground">{$t('chat.review.emptyState.headline')}</p>
              <p class="m-0 mt-1.5 text-xs leading-snug text-muted">{$t('chat.review.emptyState.subhead')}</p>
            </div>
          </div>
        {:else}
          <ul class="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0" role="list">
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
                        {rowPrimaryLabel(r)}
                      </span>
                      <span
                        class="shrink-0 rounded-full bg-surface-2 px-1.5 py-[1px] text-[0.65rem] font-semibold uppercase tracking-wide text-muted"
                      >
                        {stateLabel(r.state)}
                      </span>
                    </div>
                    <p class="m-0 mt-0.5 line-clamp-2 text-[0.75rem] text-muted">{r.askerSnippet || r.draftSnippet}</p>
                    <p class="m-0 mt-1 text-[0.65rem] text-muted">
                      {r.updatedAtMs > 0 ? formatRelativeDate(new Date(r.updatedAtMs).toISOString(), $t) : ''}
                    </p>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        {#if selected}
          <ReviewDetail row={selected} {onOpenInboundThread} onMutate={() => void loadAndAdvance()} />
        {:else if selectedId && loading}
          <div class="flex flex-1 items-center justify-center p-6 text-sm text-muted" role="status">
            {$t('common.status.loading')}
          </div>
        {:else if queueEmpty}
          <div
            class="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden p-6"
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
  {/if}
</div>
