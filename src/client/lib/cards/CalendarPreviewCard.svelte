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

<div class="calendar-card">
  <div class="card-head">
    <Calendar size={14} strokeWidth={2} aria-hidden="true" />
    <span class="card-title">Calendar</span>
    <span class="card-meta">{start}{#if end !== start} – {end}{/if}</span>
  </div>

  {#if daysWithEvents.length === 0}
    <p class="card-empty">No events in this range.</p>
  {:else}
    <div class="days-list">
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
      <p class="card-more">+ {hiddenCount} more {hiddenCount === 1 ? 'day' : 'days'} with events</p>
    {/if}
  {/if}

  {#if onOpenCalendar}
    <button type="button" class="calendar-full-btn" onclick={() => onOpenCalendar(start)}>
      Open calendar
    </button>
  {/if}
</div>

<style>
  .calendar-card {
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-3);
    max-width: 100%;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    color: var(--text-2);
    flex-wrap: wrap;
  }

  .card-title {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .card-meta {
    font-size: 11px;
    margin-left: auto;
    opacity: 0.85;
  }

  .card-empty {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--text-2);
  }

  .days-list {
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

  .card-more {
    margin: 8px 0 0;
    font-size: 11px;
    color: var(--text-2);
  }

  .calendar-full-btn {
    margin-top: 10px;
    width: 100%;
    padding: 8px 12px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--accent);
    cursor: pointer;
  }

  .calendar-full-btn:hover {
    border-color: var(--accent);
    background: var(--accent-dim);
  }
</style>
