<script lang="ts">
  import { Calendar } from 'lucide-svelte'
  import DayEvents from '../DayEvents.svelte'
  import type { CalendarEventLite } from './contentCards.js'

  let {
    start,
    end,
    events,
    onOpenCalendar,
    /** Opens the calendar panel focused on a specific event (right pane / slide-over). */
    onOpenCalendarEvent,
  }: {
    start: string
    end: string
    events: CalendarEventLite[]
    onOpenCalendar?: (_date: string) => void
    onOpenCalendarEvent?: (_date: string, _eventId: string) => void
  } = $props()

  /** Events whose start (date part) falls on `day` (YYYY-MM-DD), or all-day spanning. */
  function eventsForDay(day: string): CalendarEventLite[] {
    return events.filter((e) => {
      if (e.allDay) {
        return e.start <= day && e.end > day
      }
      return e.start.slice(0, 10) === day
    })
  }

  /** Generate array of YYYY-MM-DD strings from start to end (inclusive). */
  function getDatesInRange(s: string, e: string): string[] {
    const dates: string[] = []
    const cur = new Date(s + 'T00:00:00')
    const endD = new Date(e + 'T00:00:00')
    while (cur <= endD) {
      dates.push(cur.toISOString().slice(0, 10))
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  }

  function formatDayHeader(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const allDates = $derived(getDatesInRange(start, end))

  /** Days that have at least one event. */
  const daysWithEvents = $derived(
    allDates.map((d) => ({ date: d, events: eventsForDay(d) })).filter((d) => d.events.length > 0)
  )

  const MAX_DAYS = 5
  const displayDays = $derived(daysWithEvents.slice(0, MAX_DAYS))
  const hiddenCount = $derived(Math.max(0, daysWithEvents.length - MAX_DAYS))
</script>

<div class="calendar-tool-preview">
  <div class="calendar-tool-head">
    <Calendar size={14} strokeWidth={2} aria-hidden="true" />
    <span class="calendar-tool-title">Calendar</span>
    <span class="calendar-tool-meta">{start}{#if end !== start} – {end}{/if}</span>
  </div>

  {#if daysWithEvents.length === 0}
    <p class="calendar-tool-empty">No events in this range.</p>
  {:else}
    <div class="calendar-days-list">
      {#each displayDays as day (day.date)}
        <div class="day-group">
          <button
            type="button"
            class="day-header"
            onclick={() => onOpenCalendar?.(day.date)}
          >
            {formatDayHeader(day.date)}
          </button>
          <DayEvents
            date={day.date}
            events={day.events}
            onEventOpen={onOpenCalendarEvent
              ? (e) => onOpenCalendarEvent(day.date, e.id)
              : undefined}
          />
        </div>
      {/each}
    </div>
    {#if hiddenCount > 0}
      <p class="calendar-tool-more">+ {hiddenCount} more {hiddenCount === 1 ? 'day' : 'days'} with events</p>
    {/if}
  {/if}

  {#if onOpenCalendar}
    <button type="button" class="calendar-tool-full" onclick={() => onOpenCalendar(start)}>
      Open calendar
    </button>
  {/if}
</div>

<style>
  .calendar-tool-preview {
    margin: 4px 0 0;
    max-width: 100%;
    min-width: 0;
  }

  .calendar-tool-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    color: var(--text-2);
    flex-wrap: wrap;
  }

  .calendar-tool-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .calendar-tool-meta {
    font-size: 11px;
    margin-left: auto;
    opacity: 0.85;
  }

  .calendar-tool-empty {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--text-2);
  }

  .calendar-days-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .day-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .day-header {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }

  .day-header:hover {
    text-decoration: underline;
  }

  .calendar-tool-more {
    margin: 8px 0 0;
    font-size: 11px;
    color: var(--text-2);
  }

  .calendar-tool-full {
    margin-top: 8px;
    padding: 0;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent);
    cursor: pointer;
    text-align: left;
  }

  .calendar-tool-full:hover {
    text-decoration: underline;
  }
</style>
