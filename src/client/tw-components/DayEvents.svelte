<script lang="ts">
  import { onMount } from 'svelte'
  import { cn } from '@client/lib/cn.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  import { localYmdFromDate, localYmdFromIsoInstant } from '@client/lib/calendarLocalYmd.js'

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

  const now = new Date()
  const todayYMD = localYmdFromDate(now)

  function isPast(e: CalendarEvent): boolean {
    if (e.allDay) return e.end <= todayYMD
    return new Date(e.end) < now
  }

  const { allDay, timed } = $derived.by(() => {
    const allDayArr: CalendarEvent[] = []
    const timedArr: CalendarEvent[] = []
    for (const e of events) {
      if (e.allDay) {
        if (e.start <= date && e.end > date) allDayArr.push(e)
      } else {
        if (localYmdFromIsoInstant(e.start) === date) timedArr.push(e)
      }
    }
    return { allDay: allDayArr, timed: timedArr }
  })

  onMount(() => {
    if (propEvents === undefined) fetchForDate(date)
  })
  const colors = [
    '#3b82f6',
    '#ef4444',
    '#10b981',
    '#f59e0b',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#f97316',
  ]

  function getColorForSource(e: CalendarEvent): string {
    const key = e.calendarId || e.source || 'default'
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  /** Shared hover/focus styles + base layout for the compact-hit button + non-interactive list item. */
  const baseRow = 'de-event flex items-baseline gap-[5px] rounded-[3px] px-[7px] py-[3px] text-xs leading-[1.4]'
  const travelBg =
    'travel border-l-2 border-l-[var(--accent,#f59e0b)] bg-[var(--custom-bg,color-mix(in_srgb,#f59e0b_15%,transparent))]'
  const personalBg =
    'personal border-l-2 border-l-[var(--accent)] bg-[var(--custom-bg,color-mix(in_srgb,var(--accent)_10%,transparent))]'
  const interactiveBg =
    'de-compact-hit w-full cursor-pointer border-none p-0 px-[7px] py-[3px] text-left font-[inherit] text-[inherit] hover:brightness-[1.06] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'
  const previewHover =
    'de-preview-hover hover:brightness-[1.08] hover:[box-shadow:inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_28%,transparent)]'
</script>

<ul class="de-list m-0 flex list-none flex-col gap-[3px] p-0">
  {#each allDay as e (e.id)}
    {@const eventColor = e.color || getColorForSource(e)}
    {#if interactive}
      <li class="de-li-compact m-0 list-none p-0">
        <button
          type="button"
          class={cn(
            baseRow,
            interactiveBg,
            travelBg,
            !!onEventOpen && previewHover,
            isPast(e) && 'past opacity-45',
            selectedEventId === e.id && 'de-selected outline outline-2 outline-offset-1 outline-accent',
          )}
          style="--accent: {eventColor}; --custom-bg: color-mix(in srgb, {eventColor} 15%, transparent);"
          aria-label={onEventOpen ? `Open ${e.title} in calendar` : `View details: ${e.title}`}
          title={e.location ?? ''}
          onclick={() => handleEventClick(e)}
        >
          <span class="de-icon shrink-0 text-[11px]" aria-hidden="true">✈</span>
          <span class="de-title flex-1 truncate font-medium text-foreground">{e.title}</span>
        </button>
      </li>
    {:else}
      <li
        class={cn(baseRow, travelBg, isPast(e) && 'past opacity-45')}
        style="--accent: {eventColor}; --custom-bg: color-mix(in srgb, {eventColor} 15%, transparent);"
        title={e.location ?? ''}
      >
        <span class="de-icon shrink-0 text-[11px]">✈</span>
        <span class="de-title flex-1 truncate font-medium text-foreground">{e.title}</span>
      </li>
    {/if}
  {/each}
  {#each timed as e (e.id)}
    {@const eventColor = e.color || getColorForSource(e)}
    {#if interactive}
      <li class="de-li-compact m-0 list-none p-0">
        <button
          type="button"
          class={cn(
            baseRow,
            interactiveBg,
            personalBg,
            !!onEventOpen && previewHover,
            isPast(e) && 'past opacity-45',
            selectedEventId === e.id && 'de-selected outline outline-2 outline-offset-1 outline-accent',
          )}
          style="--accent: {eventColor}; --custom-bg: color-mix(in srgb, {eventColor} 10%, transparent);"
          aria-label={onEventOpen ? `Open ${e.title} in calendar` : `View details: ${e.title}`}
          title={[formatTimeRange(e), e.location, e.description].filter(Boolean).join(' · ')}
          onclick={() => handleEventClick(e)}
        >
          <span class="de-time min-w-[65px] shrink-0 text-[11px] tabular-nums text-muted">{formatTime(e.start)}</span>
          <span class="de-title flex-1 truncate font-medium text-foreground">{e.title}</span>
          {#if e.location}<span class="de-loc max-w-[100px] shrink-0 truncate text-[10px] text-muted">{e.location}</span>{/if}
        </button>
      </li>
    {:else}
      <li
        class={cn(
          baseRow,
          personalBg,
          isPast(e) && 'past opacity-45',
          selectedEventId === e.id && 'de-selected outline outline-2 outline-offset-1 outline-accent',
        )}
        style="--accent: {eventColor}; --custom-bg: color-mix(in srgb, {eventColor} 10%, transparent);"
        title={[e.location, e.description].filter(Boolean).join(' · ')}
      >
        <span class="de-time min-w-[65px] shrink-0 text-[11px] tabular-nums text-muted">{formatTime(e.start)}</span>
        <span class="de-title flex-1 truncate font-medium text-foreground">{e.title}</span>
        {#if e.location}<span class="de-loc max-w-[100px] shrink-0 truncate text-[10px] text-muted">{e.location}</span>{/if}
      </li>
    {/if}
  {/each}
</ul>
