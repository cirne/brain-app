<script lang="ts">
  import { onMount } from 'svelte'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'

  export interface CalendarEvent {
    id: string
    title: string
    start: string
    end: string
    allDay: boolean
    source: string
    calendarId?: string
    location?: string
    description?: string
    attendees?: string[]
    organizer?: string
    color?: string
  }

  /**
   * Compact, reusable event list for a single day.
   * - Pass `events` if already loaded (e.g. from a week fetch) to skip the API call.
   * - Omit `events` to auto-fetch from /api/calendar for the given `date`.
   * - `onEventOpen` vs `onEventSelect` only affects click routing and optional hover styling, not layout.
   */
  let {
    date,
    events: propEvents,
    /** Chat preview: click opens calendar panel (optional hover accent). */
    onEventOpen,
    /** Week view: click opens in-calendar drill-down. */
    onEventSelect,
    /** Highlights a row (e.g. deep-linked from URL). */
    selectedEventId,
  }: {
    date: string
    events?: CalendarEvent[]
    onEventOpen?: (_e: CalendarEvent) => void
    onEventSelect?: (_e: CalendarEvent) => void
    selectedEventId?: string
  } = $props()

  let fetchedEvents = $state<CalendarEvent[]>([])

  const events = $derived(propEvents ?? fetchedEvents)

  const interactive = $derived(!!onEventOpen || !!onEventSelect)

  const dayEventsLatest = createAsyncLatest({ abortPrevious: true })

  function handleEventClick(e: CalendarEvent) {
    if (onEventOpen) onEventOpen(e)
    else onEventSelect?.(e)
  }

  // Only fetch when no events are provided externally
  $effect(() => {
    if (propEvents === undefined) {
      fetchForDate(date)
    }
  })

  async function fetchForDate(d: string) {
    const { token, signal } = dayEventsLatest.begin()
    try {
      const res = await fetch(`/api/calendar?start=${d}&end=${d}`, { signal })
      if (dayEventsLatest.isStale(token)) return
      if (res.ok) {
        const data = await res.json()
        if (dayEventsLatest.isStale(token)) return
        fetchedEvents = data.events as CalendarEvent[]
      }
    } catch (e) {
      if (!dayEventsLatest.isStale(token) && !isAbortError(e)) {
        /* ignore */
      }
    }
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  function formatTimeRange(e: CalendarEvent): string {
    if (e.allDay) return 'All day'
    return `${formatTime(e.start)} – ${formatTime(e.end)}`
  }

  function localYMD(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const now = new Date()
  const todayYMD = localYMD(now)

  function isPast(e: CalendarEvent): boolean {
    if (e.allDay) return e.end <= todayYMD
    return new Date(e.end) < now
  }

  /** Split events into all-day and timed for this specific date. */
  const { allDay, timed } = $derived.by(() => {
    const allDayArr: CalendarEvent[] = []
    const timedArr: CalendarEvent[] = []
    for (const e of events) {
      if (e.allDay) {
        // show on all days in [start, end) — DTEND is exclusive
        if (e.start <= date && e.end > date) allDayArr.push(e)
      } else {
        if (e.start.slice(0, 10) === date) timedArr.push(e)
      }
    }
    return { allDay: allDayArr, timed: timedArr }
  })

  onMount(() => {
    if (propEvents === undefined) fetchForDate(date)
  })
  const colors = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#10b981', // emerald
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316', // orange
  ]

  function getColorForSource(e: CalendarEvent): string {
    const key = e.calendarId || e.source || 'default'
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }
</script>

<ul class="de-list">
  {#each allDay as e (e.id)}
    {@const eventColor = e.color || getColorForSource(e)}
    {#if interactive}
      <li class="de-li-compact">
        <button
          type="button"
          class="de-event travel de-compact-hit"
          style="--accent: {eventColor}; --custom-bg: color-mix(in srgb, {eventColor} 15%, transparent);"
          class:de-preview-hover={!!onEventOpen}
          class:past={isPast(e)}
          class:de-selected={selectedEventId === e.id}
          aria-label={onEventOpen ? `Open ${e.title} in calendar` : `View details: ${e.title}`}
          title={e.location ?? ''}
          onclick={() => handleEventClick(e)}
        >
          <span class="de-icon" aria-hidden="true">✈</span>
          <span class="de-title">{e.title}</span>
        </button>
      </li>
    {:else}
      <li
        class="de-event travel"
        style="--accent: {eventColor}; --custom-bg: color-mix(in srgb, {eventColor} 15%, transparent);"
        class:past={isPast(e)}
        title={e.location ?? ''}
      >
        <span class="de-icon">✈</span>
        <span class="de-title">{e.title}</span>
      </li>
    {/if}
  {/each}
  {#each timed as e (e.id)}
    {@const eventColor = e.color || getColorForSource(e)}
    {#if interactive}
      <li class="de-li-compact">
        <button
          type="button"
          class="de-event personal de-compact-hit"
          style="--accent: {eventColor}; --custom-bg: color-mix(in srgb, {eventColor} 10%, transparent);"
          class:de-preview-hover={!!onEventOpen}
          class:past={isPast(e)}
          class:de-selected={selectedEventId === e.id}
          aria-label={onEventOpen ? `Open ${e.title} in calendar` : `View details: ${e.title}`}
          title={[formatTimeRange(e), e.location, e.description].filter(Boolean).join(' · ')}
          onclick={() => handleEventClick(e)}
        >
          <span class="de-time">{formatTime(e.start)}</span>
          <span class="de-title">{e.title}</span>
          {#if e.location}<span class="de-loc">{e.location}</span>{/if}
        </button>
      </li>
    {:else}
      <li
        class="de-event personal"
        style="--accent: {eventColor}; --custom-bg: color-mix(in srgb, {eventColor} 10%, transparent);"
        class:past={isPast(e)}
        class:de-selected={selectedEventId === e.id}
        title={[e.location, e.description].filter(Boolean).join(' · ')}
      >
        <span class="de-time">{formatTime(e.start)}</span>
        <span class="de-title">{e.title}</span>
        {#if e.location}<span class="de-loc">{e.location}</span>{/if}
      </li>
    {/if}
  {/each}
</ul>

<style>
  .de-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .de-event {
    display: flex;
    align-items: baseline;
    gap: 5px;
    padding: 3px 7px;
    border-radius: 3px;
    font-size: 12px;
    line-height: 1.4;
  }

  .de-event.travel {
    background: var(--custom-bg, color-mix(in srgb, #f59e0b 15%, transparent));
    border-left: 2px solid var(--accent, #f59e0b);
  }

  .de-event.personal {
    background: var(--custom-bg, color-mix(in srgb, var(--accent) 10%, transparent));
    border-left: 2px solid var(--accent);
  }

  .de-event.past {
    opacity: 0.45;
  }

  .de-event.de-selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .de-icon {
    font-size: 11px;
    flex-shrink: 0;
  }

  .de-time {
    font-size: 11px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    min-width: 65px;
  }

  .de-title {
    color: var(--text);
    font-weight: 500;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .de-loc {
    font-size: 10px;
    color: var(--text-2);
    flex-shrink: 0;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .de-li-compact {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  button.de-compact-hit {
    display: flex;
    align-items: baseline;
    gap: 5px;
    width: 100%;
    margin: 0;
    padding: 3px 7px;
    border: none;
    border-radius: 3px;
    font: inherit;
    text-align: left;
    cursor: pointer;
    color: inherit;
  }

  button.de-compact-hit.de-event.travel {
    background: var(--custom-bg, color-mix(in srgb, #f59e0b 15%, transparent));
    border-left: 2px solid var(--accent, #f59e0b);
  }

  button.de-compact-hit.de-event.personal {
    background: var(--custom-bg, color-mix(in srgb, var(--accent) 10%, transparent));
    border-left: 2px solid var(--accent);
  }

  button.de-compact-hit:hover {
    filter: brightness(1.06);
  }

  button.de-compact-hit.de-preview-hover:hover {
    filter: brightness(1.08);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
  }

  button.de-compact-hit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
