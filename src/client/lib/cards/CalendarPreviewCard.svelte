<script lang="ts">
  import DayEvents from '../DayEvents.svelte'
  import type { CalendarEventLite } from './contentCards.js'

  let {
    start,
    end,
    events,
  }: {
    start: string
    end: string
    events: CalendarEventLite[]
  } = $props()

  /** Events whose start (date part) falls on `day` (YYYY-MM-DD). */
  function eventsForDay(day: string): CalendarEventLite[] {
    return events.filter((e) => {
      const d = e.start.slice(0, 10)
      return d === day
    })
  }

  const firstDayEvents = $derived(eventsForDay(start))
</script>

<div class="calendar-card">
  <div class="card-meta">{start}{#if end !== start} – {end}{/if}</div>
  <DayEvents date={start} events={firstDayEvents.length ? firstDayEvents : undefined} />
</div>

<style>
  .calendar-card {
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-3);
  }
  .card-meta {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 8px;
  }
</style>
