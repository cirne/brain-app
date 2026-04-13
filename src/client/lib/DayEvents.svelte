<script lang="ts">
  import { onMount } from 'svelte'

  export interface CalendarEvent {
    id: string
    title: string
    start: string
    end: string
    allDay: boolean
    source: 'travel' | 'personal'
    location?: string
    description?: string
  }

  /**
   * Compact, reusable event list for a single day.
   * - Pass `events` if already loaded (e.g. from a week fetch) to skip the API call.
   * - Omit `events` to auto-fetch from /api/calendar for the given `date`.
   */
  let {
    date,
    events: propEvents,
  }: {
    date: string
    events?: CalendarEvent[]
  } = $props()

  let fetchedEvents = $state<CalendarEvent[]>([])
  let loading = $state(false)

  const events = $derived(propEvents ?? fetchedEvents)

  // Only fetch when no events are provided externally
  $effect(() => {
    if (propEvents === undefined) {
      fetchForDate(date)
    }
  })

  async function fetchForDate(d: string) {
    loading = true
    try {
      const res = await fetch(`/api/calendar?start=${d}&end=${d}`)
      if (res.ok) {
        const data = await res.json()
        fetchedEvents = data.events as CalendarEvent[]
      }
    } finally {
      loading = false
    }
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
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
</script>

{#if loading}
  <div class="de-loading">…</div>
{:else if allDay.length === 0 && timed.length === 0}
  <div class="de-empty">No events</div>
{:else}
  <ul class="de-list">
    {#each allDay as e (e.id)}
      <li class="de-event travel" title={e.location ?? ''}>
        <span class="de-icon">✈</span>
        <span class="de-title">{e.title}</span>
      </li>
    {/each}
    {#each timed as e (e.id)}
      <li class="de-event personal" title={[e.location, e.description].filter(Boolean).join(' · ')}>
        <span class="de-time">{formatTime(e.start)}</span>
        <span class="de-title">{e.title}</span>
        {#if e.location}<span class="de-loc">{e.location}</span>{/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .de-loading, .de-empty {
    font-size: 12px;
    color: var(--text-2);
    padding: 2px 0;
    opacity: 0.6;
  }

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
    background: color-mix(in srgb, #f59e0b 15%, transparent);
    border-left: 2px solid #f59e0b;
  }

  .de-event.personal {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-left: 2px solid var(--accent);
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
</style>
