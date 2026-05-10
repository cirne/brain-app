<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte'
  import { cn } from '@client/lib/cn.js'
  import DayEvents, { type CalendarEvent } from '@components/DayEvents.svelte'
  import CalendarEventDetail from '@components/CalendarEventDetail.svelte'

  import type { SurfaceContext } from '@client/router.js'
  import { getCalendarSlideHeaderCell } from '@client/lib/calendarSlideHeaderContext.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  import { localYmdFromDate } from '@client/lib/calendarLocalYmd.js'
  import { t } from '@client/lib/i18n/index.js'

  let {
    refreshKey = 0,
    initialDate,
    /** When opening from chat preview / URL, scroll and highlight this event in the day list. */
    initialEventId,
    onContextChange,
    onOpenWiki,
    onOpenEmail,
    /** Sync URL + agent context to “today” without `event=` (parent uses router). */
    onResetToToday,
    /** Keep `?panel=calendar&date=&event=` in sync when opening/closing event drill-down. */
    onCalendarNavigate,
  }: {
    refreshKey?: number
    initialDate?: string
    initialEventId?: string
    onContextChange?: (_ctx: SurfaceContext) => void
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onResetToToday?: () => void
    onCalendarNavigate?: (_date: string, _eventId?: string) => void
  } = $props()

  let weekStart = $state(sundayOf(new Date()))
  let events = $state<CalendarEvent[]>([])
  let loading = $state(false)
  let fetchedAt = $state({ ripmail: '' })
  let sourcesConfigured = $state(false)

  /** Drill-down: full event detail (title, when, where, notes). */
  let detailEvent = $state<CalendarEvent | null>(null)
  /** Avoid immediately re-opening detail after user taps Back while URL still has `event=`. */
  let userClosedDetail = $state(false)
  let lastInitialEventIdProp = $state<string | undefined>(undefined)

  const calendarEventsLatest = createAsyncLatest({ abortPrevious: true })

  function openEventDetail(e: CalendarEvent, dateYmd: string) {
    detailEvent = e
    userClosedDetail = false
    onCalendarNavigate?.(dateYmd, e.id)
  }

  function closeEventDetail() {
    detailEvent = null
    userClosedDetail = true
    if (initialDate) {
      onCalendarNavigate?.(initialDate, undefined)
    }
  }

  /** Sync `?panel=calendar&event=` to detail when opening from chat preview or URL changes. */
  $effect(() => {
    if (initialEventId !== lastInitialEventIdProp) {
      lastInitialEventIdProp = initialEventId
      userClosedDetail = false
      if (!initialEventId) {
        return
      }
      const found = events.find((e) => e.id === initialEventId)
      if (found) {
        detailEvent = found
      }
      return
    }
    if (!initialEventId || detailEvent !== null || userClosedDetail) {
      return
    }
    const found = events.find((e) => e.id === initialEventId)
    if (found) {
      detailEvent = found
    }
  })

  /** Clear detail when the focused event is not in the loaded week. */
  $effect(() => {
    if (!detailEvent) {
      return
    }
    if (!events.some((e) => e.id === detailEvent.id)) {
      detailEvent = null
    }
  })

  $effect(() => {
    if (initialDate) {
      weekStart = sundayOf(new Date(initialDate + 'T12:00:00'))
    }
  })

  // Reload when week changes or a global sync completes; single effect avoids duplicate loadEvents.
  $effect(() => {
    void refreshKey
    void weekStart
    loadEvents()
    const now = new Date()
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    /** Parent prop callback identity may change every render — invoke under `untrack` so we never subscribe to it. */
    untrack(() => onContextChange?.({ type: 'calendar', date: localDate }))
  })

  function sundayOf(d: Date): Date {
    const s = new Date(d)
    s.setHours(0, 0, 0, 0)
    s.setDate(s.getDate() - s.getDay())
    return s
  }

  function addDays(d: Date, n: number): Date {
    const result = new Date(d)
    result.setDate(result.getDate() + n)
    return result
  }

  function toYMD(d: Date): string {
    return localYmdFromDate(d)
  }

  async function loadEvents() {
    const { token, signal } = calendarEventsLatest.begin()
    loading = true
    const start = toYMD(weekStart)
    const end = toYMD(addDays(weekStart, 6))
    try {
      const res = await fetch(`/api/calendar?start=${start}&end=${end}`, { signal })
      if (calendarEventsLatest.isStale(token)) return
      if (res.ok) {
        const data = await res.json()
        if (calendarEventsLatest.isStale(token)) return
        events = data.events
        fetchedAt = data.fetchedAt
        sourcesConfigured = data.sourcesConfigured ?? false
      }
    } catch (e) {
      if (!calendarEventsLatest.isStale(token) && !isAbortError(e)) {
        /* ignore */
      }
    } finally {
      if (!calendarEventsLatest.isStale(token)) loading = false
    }
  }

  async function refreshCalendarSources() {
    loading = true
    try {
      await fetch('/api/calendar/refresh', { method: 'POST' })
      await loadEvents()
    } finally {
      loading = false
    }
  }

  function prevWeek() { weekStart = addDays(weekStart, -7) }
  function nextWeek() { weekStart = addDays(weekStart, 7) }
  function goToday() {
    closeEventDetail()
    weekStart = sundayOf(new Date())
    onResetToToday?.()
  }

  const days = $derived(
    Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i)
      return { date: d, ymd: toYMD(d) }
    })
  )

  const weekLabel = $derived(() => {
    const start = days[0].date
    const end = days[6].date
    const sameMonth = start.getMonth() === end.getMonth()
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    if (sameMonth) {
      return `${start.toLocaleDateString('en-US', opts)}–${end.getDate()}, ${end.getFullYear()}`
    }
    return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`
  })

  const todayYMD = localYmdFromDate(new Date())

  function formatDayHeader(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const configured = $derived(sourcesConfigured || !!fetchedAt.ripmail || events.length > 0)

  const calendarHeaderCell = getCalendarSlideHeaderCell()

  /** Stable refresh handler — referenced inside the cell payload + L2 button. */
  function refreshCalendarsFromHeader() {
    void refreshCalendarSources()
  }

  /**
   * Claim the calendar header cell once with stable handler identities. Reactive scalars
   * (weekLabel, headerBusy) flow through the `$effect` below via `patch`. The initial reads
   * here are wrapped in `untrack` so Svelte does not warn about capturing initial values.
   * See archived BUG-047 (effect depth / slide headers).
   */
  const calendarHeaderCtrl = calendarHeaderCell?.claim(
    untrack(() => ({
      weekLabel: weekLabel(),
      prevWeek,
      nextWeek,
      goToday,
      refreshCalendars: refreshCalendarsFromHeader,
      headerBusy: loading,
    })),
  )

  $effect(() => {
    calendarHeaderCtrl?.patch({
      weekLabel: weekLabel(),
      headerBusy: loading,
    })
  })

  onDestroy(() => {
    calendarHeaderCtrl?.clear()
  })

  onMount(() => { loadEvents() })
</script>

<div class="calendar flex h-full flex-col overflow-hidden">
  {#if !configured && !loading}
    <div
      class="empty-state flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center text-muted"
    >
      {#if sourcesConfigured}
        <p class="m-0 text-sm">{$t('hub.calendar.empty.noData')}</p>
        <button
          class="sync-btn cursor-pointer rounded-md border border-border bg-surface-3 px-4 py-1.5 text-[13px] text-foreground hover:border-accent hover:text-accent"
          onclick={() => { void refreshCalendarSources() }}
        >{$t('hub.calendar.actions.syncNow')}</button>
      {:else}
        <p class="m-0 text-sm">{$t('hub.calendar.empty.notConfigured')}</p>
        <p class="hint m-0 max-w-[320px] text-xs leading-[1.5]">
          {$t('hub.calendar.empty.hintBeforeCode')}
          <code
            class="font-mono text-accent"
          >{$t('hub.calendar.empty.hintCode')}</code>{$t('hub.calendar.empty.hintAfterCode')}
        </p>
      {/if}
    </div>
  {:else if detailEvent}
    <div class="detail-drill flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="detail-drill-body min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-3">
        <CalendarEventDetail event={detailEvent} {onOpenWiki} {onOpenEmail} />
      </div>
    </div>
  {:else}
    <div class="days flex-1 overflow-y-auto py-2">
      {#each days as { date, ymd } (ymd)}
        <div
          class={cn(
            'day border-b border-border px-3.5 py-2.5',
            ymd === todayYMD && 'today bg-[color-mix(in_srgb,var(--accent)_5%,transparent)]',
            ymd === initialDate && 'linked border-l-2 border-l-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]',
          )}
        >
          <div class="day-header mb-1.5 flex items-center gap-2">
            <span
              class={cn(
                'day-label text-[13px] font-semibold uppercase tracking-[0.04em] text-muted',
                ymd === todayYMD && 'today-label !text-accent',
              )}
            >{formatDayHeader(date)}</span>
            {#if ymd === todayYMD}
              <span
                class="today-badge bg-accent px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.04em] text-white"
              >{$t('hub.calendar.todayBadge')}</span>
            {/if}
          </div>
          <DayEvents
            date={ymd}
            {events}
            selectedEventId={initialEventId}
            onEventSelect={(e) => openEventDetail(e, ymd)}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>
