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
    attendees?: string[]
    organizer?: string
  }

  /**
   * Compact, reusable event list for a single day.
   * - Pass `events` if already loaded (e.g. from a week fetch) to skip the API call.
   * - Omit `events` to auto-fetch from /api/calendar for the given `date`.
   */
  let {
    date,
    events: propEvents,
    /** When set, rows show time range, title, location, and a description snippet; click opens the calendar panel. */
    onEventOpen,
    /** Compact list: click opens in-calendar drill-down (week view in SlideOver / Calendar). */
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

  function formatTimeRange(e: CalendarEvent): string {
    if (e.allDay) return 'All day'
    return `${formatTime(e.start)} – ${formatTime(e.end)}`
  }

  function descSnippet(text: string | undefined, maxLen: number): string {
    if (!text?.trim()) return ''
    const one = text.replace(/\s+/g, ' ').trim()
    return one.length > maxLen ? `${one.slice(0, maxLen - 1)}…` : one
  }

  const richPreview = $derived(!!onEventOpen)

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
</script>

{#if loading}
  <div class="de-loading">…</div>
{:else if allDay.length === 0 && timed.length === 0}
  <div class="de-empty">No events</div>
{:else}
  <ul class="de-list" class:de-rich={richPreview}>
    {#each allDay as e (e.id)}
      {#if richPreview}
        <li class="de-li-rich">
          <button
            type="button"
            class="de-rich de-event travel"
            class:past={isPast(e)}
            class:de-selected={selectedEventId === e.id}
            aria-label="Open {e.title} in calendar"
            onclick={() => onEventOpen?.(e)}
          >
            <span class="de-rich-time">{formatTimeRange(e)}</span>
            <span class="de-rich-main">
              <span class="de-rich-title-row">
                <span class="de-icon" aria-hidden="true">✈</span>
                <span class="de-rich-title">{e.title}</span>
              </span>
              {#if e.location}
                <span class="de-rich-meta">{e.location}</span>
              {:else if e.description}
                <span class="de-rich-desc">{descSnippet(e.description, 140)}</span>
              {/if}
            </span>
          </button>
        </li>
      {:else if onEventSelect}
        <li class="de-li-compact">
          <button
            type="button"
            class="de-event travel de-compact-hit"
            class:past={isPast(e)}
            class:de-selected={selectedEventId === e.id}
            aria-label="View details: {e.title}"
            onclick={() => onEventSelect(e)}
          >
            <span class="de-icon" aria-hidden="true">✈</span>
            <span class="de-title">{e.title}</span>
          </button>
        </li>
      {:else}
        <li class="de-event travel" class:past={isPast(e)} title={e.location ?? ''}>
          <span class="de-icon">✈</span>
          <span class="de-title">{e.title}</span>
        </li>
      {/if}
    {/each}
    {#each timed as e (e.id)}
      {#if richPreview}
        <li class="de-li-rich">
          <button
            type="button"
            class="de-rich de-event personal"
            class:past={isPast(e)}
            class:de-selected={selectedEventId === e.id}
            aria-label="Open {e.title} in calendar"
            onclick={() => onEventOpen?.(e)}
          >
            <span class="de-rich-time">{formatTimeRange(e)}</span>
            <span class="de-rich-main">
              <span class="de-rich-title">{e.title}</span>
              {#if e.location}
                <span class="de-rich-meta">{e.location}</span>
              {/if}
              {#if e.description}
                <span class="de-rich-desc">{descSnippet(e.description, 160)}</span>
              {/if}
            </span>
          </button>
        </li>
      {:else if onEventSelect}
        <li class="de-li-compact">
          <button
            type="button"
            class="de-event personal de-compact-hit"
            class:past={isPast(e)}
            class:de-selected={selectedEventId === e.id}
            aria-label="View details: {e.title}"
            onclick={() => onEventSelect(e)}
          >
            <span class="de-time">{formatTime(e.start)}</span>
            <span class="de-title">{e.title}</span>
            {#if e.location}<span class="de-loc">{e.location}</span>{/if}
          </button>
        </li>
      {:else}
        <li
          class="de-event personal"
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

  .de-event.past {
    opacity: 0.45;
  }

  .de-event.de-selected {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .de-list.de-rich {
    gap: 8px;
  }

  .de-li-rich {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  button.de-rich {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-2);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }

  button.de-rich:hover {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
    background: var(--bg-3);
  }

  button.de-rich:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  button.de-rich.travel {
    border-left: 3px solid #f59e0b;
  }

  button.de-rich.personal {
    border-left: 3px solid var(--accent);
  }

  button.de-rich.de-selected {
    outline: 2px solid var(--accent);
    outline-offset: 0;
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-2));
  }

  .de-rich-time {
    font-size: 11px;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    min-width: 118px;
    padding-top: 2px;
  }

  .de-rich-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }

  .de-rich-title-row {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }

  .de-rich-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.35;
    word-break: break-word;
  }

  .de-rich-meta {
    font-size: 12px;
    color: var(--text-2);
    line-height: 1.35;
    word-break: break-word;
  }

  .de-rich-desc {
    font-size: 11px;
    color: var(--text-2);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
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
    background: color-mix(in srgb, #f59e0b 15%, transparent);
    border-left: 2px solid #f59e0b;
  }

  button.de-compact-hit.de-event.personal {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-left: 2px solid var(--accent);
  }

  button.de-compact-hit:hover {
    filter: brightness(1.06);
  }

  button.de-compact-hit:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
