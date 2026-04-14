<script lang="ts">
  import { onMount } from 'svelte'
  import DayEvents, { type CalendarEvent } from './DayEvents.svelte'
  import CalendarEventDetail from './CalendarEventDetail.svelte'

  import type { SurfaceContext } from '../router.js'

  let {
    refreshKey = 0,
    initialDate,
    /** When opening from chat preview / URL, scroll and highlight this event in the day list. */
    initialEventId,
    onContextChange,
    onOpenWiki,
    onOpenEmail,
  }: {
    refreshKey?: number
    initialDate?: string
    initialEventId?: string
    onContextChange?: (_ctx: SurfaceContext) => void
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
  } = $props()

  let weekStart = $state(sundayOf(new Date()))
  let events = $state<CalendarEvent[]>([])
  let loading = $state(false)
  let fetchedAt = $state({ travel: '', personal: '' })
  let urlsConfigured = $state(false)

  /** Drill-down: full event detail (title, when, where, notes). */
  let detailEvent = $state<CalendarEvent | null>(null)
  /** Avoid immediately re-opening detail after user taps Back while URL still has `event=`. */
  let userClosedDetail = $state(false)
  let lastInitialEventIdProp = $state<string | undefined>(undefined)

  function openEventDetail(e: CalendarEvent) {
    detailEvent = e
    userClosedDetail = false
  }

  function closeEventDetail() {
    detailEvent = null
    userClosedDetail = true
  }

  /** Sync `/calendar?event=` to detail when opening from chat preview or URL changes. */
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

  // Jump to initialDate when it changes (e.g. navigating from chat)
  $effect(() => {
    if (initialDate) {
      weekStart = sundayOf(new Date(initialDate + 'T12:00:00'))
    }
  })

  // Reload when week changes or a global sync completes
  $effect(() => {
    void refreshKey
    loadEvents()
  })

  $effect(() => {
    void weekStart
    loadEvents()
    const now = new Date()
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    onContextChange?.({ type: 'calendar', date: localDate })
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
    return d.toISOString().slice(0, 10)
  }

  async function loadEvents() {
    loading = true
    const start = toYMD(weekStart)
    const end = toYMD(addDays(weekStart, 6))
    try {
      const res = await fetch(`/api/calendar?start=${start}&end=${end}`)
      if (res.ok) {
        const data = await res.json()
        events = data.events
        fetchedAt = data.fetchedAt
        urlsConfigured = data.urlsConfigured ?? false
      }
    } finally {
      loading = false
    }
  }

  async function sync() {
    loading = true
    try {
      await fetch('/api/calendar/sync', { method: 'POST' })
      await loadEvents()
    } finally {
      loading = false
    }
  }

  function prevWeek() { weekStart = addDays(weekStart, -7) }
  function nextWeek() { weekStart = addDays(weekStart, 7) }
  function goToday() { weekStart = sundayOf(new Date()) }

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

  const todayYMD = new Date().toISOString().slice(0, 10)

  function formatDayHeader(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  function lastSynced(): string {
    const ts = fetchedAt.personal || fetchedAt.travel
    if (!ts) return 'never synced'
    const d = new Date(ts)
    const diff = Date.now() - d.getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const configured = $derived(!!fetchedAt.travel || !!fetchedAt.personal || events.length > 0)

  onMount(() => { loadEvents() })
</script>

<div class="calendar">
  <div class="toolbar">
    <div class="week-nav">
      <button onclick={prevWeek} class="nav-btn" aria-label="Previous week">&#8592;</button>
      <span class="week-label">{weekLabel()}</span>
      <button onclick={nextWeek} class="nav-btn" aria-label="Next week">&#8594;</button>
    </div>
    <div class="toolbar-right">
      <button onclick={goToday} class="today-btn">Today</button>
      {#if loading}
        <span class="sync-hint">loading…</span>
      {:else if fetchedAt.travel || fetchedAt.personal}
        <span class="sync-hint">synced {lastSynced()}</span>
      {/if}
    </div>
  </div>

  {#if !configured && !loading}
    <div class="empty-state">
      {#if urlsConfigured}
        <p>No calendar data yet.</p>
        <button class="sync-btn" onclick={sync}>↻ Sync now</button>
      {:else}
        <p>No calendar configured.</p>
        <p class="hint">Set <code>CIRNE_TRAVEL_ICS_URL</code> and <code>LEW_PERSONAL_ICS_URL</code> in your .env.</p>
      {/if}
    </div>
  {:else if detailEvent}
    <div class="detail-drill">
      <div class="detail-drill-toolbar">
        <button type="button" class="detail-back" onclick={closeEventDetail}>
          ← Back to week
        </button>
      </div>
      <div class="detail-drill-body">
        <CalendarEventDetail event={detailEvent} {onOpenWiki} {onOpenEmail} />
      </div>
    </div>
  {:else}
    <div class="days">
      {#each days as { date, ymd }}
        <div class="day" class:today={ymd === todayYMD} class:linked={ymd === initialDate}>
          <div class="day-header">
            <span class="day-label" class:today-label={ymd === todayYMD}>{formatDayHeader(date)}</span>
            {#if ymd === todayYMD}<span class="today-badge">today</span>{/if}
          </div>
          <DayEvents
            date={ymd}
            {events}
            selectedEventId={initialEventId}
            onEventSelect={openEventDetail}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .calendar {
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
    gap: 8px;
  }

  .week-nav {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .week-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
    min-width: 180px;
    text-align: center;
  }

  .nav-btn {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    font-size: 16px;
    color: var(--text-2);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nav-btn:hover { color: var(--text); background: var(--bg-3); }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .today-btn {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid var(--border);
    color: var(--text-2);
  }

  .today-btn:hover { color: var(--text); border-color: var(--text-2); }

  .sync-hint {
    font-size: 11px;
    color: var(--text-2);
  }

  .days {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .day {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .day.today {
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }

  .day.linked {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-left: 2px solid var(--accent);
  }

  .day-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .day-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .day-label.today-label { color: var(--accent); }

  .today-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px 24px;
    text-align: center;
    color: var(--text-2);
  }

  .empty-state p { margin: 0; font-size: 14px; }
  .empty-state .hint { font-size: 12px; max-width: 320px; line-height: 1.5; }
  .empty-state code { color: var(--accent); font-family: monospace; }

  .sync-btn {
    font-size: 13px;
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid var(--border);
    color: var(--text);
    background: var(--bg-3);
    cursor: pointer;
  }
  .sync-btn:hover { border-color: var(--accent); color: var(--accent); }

  .detail-drill {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .detail-drill-toolbar {
    flex-shrink: 0;
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
  }

  .detail-back {
    font-size: 13px;
    font-weight: 500;
    color: var(--accent);
    padding: 6px 8px;
    margin: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
  }

  .detail-back:hover {
    background: var(--accent-dim);
  }

  .detail-drill-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px 14px 24px;
  }
</style>
