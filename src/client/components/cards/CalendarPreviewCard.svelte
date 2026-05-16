<script lang="ts">
  import { Calendar } from '@lucide/svelte'
  import { localYmdFromDate, localYmdFromIsoInstant } from '@client/lib/calendarLocalYmd.js'
  import { t } from '@client/lib/i18n/index.js'
  import DayEvents from '@components/DayEvents.svelte'
  import type { CalendarEventLite } from '@client/lib/cards/contentCards.js'

  let {
    start,
    end,
    events,
    onOpenCalendar,
    onOpenCalendarEvent,
  }: {
    start: string
    end: string
    events: CalendarEventLite[]
    onOpenCalendar?: (_date: string) => void
    onOpenCalendarEvent?: (_date: string, _eventId: string) => void
  } = $props()

  function eventsForDay(day: string): CalendarEventLite[] {
    return events.filter((e) => {
      if (e.allDay) {
        return e.start <= day && e.end > day
      }
      return localYmdFromIsoInstant(e.start) === day
    })
  }

  function getDatesInRange(s: string, e: string): string[] {
    const dates: string[] = []
    const cur = new Date(s + 'T00:00:00')
    const endD = new Date(e + 'T00:00:00')
    while (cur <= endD) {
      dates.push(localYmdFromDate(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return dates
  }

  function formatDayHeader(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const allDates = $derived(getDatesInRange(start, end))

  const daysWithEvents = $derived(
    allDates.map((d) => ({ date: d, events: eventsForDay(d) })).filter((d) => d.events.length > 0),
  )

  const MAX_DAYS = 5
  const displayDays = $derived(daysWithEvents.slice(0, MAX_DAYS))
  const hiddenCount = $derived(Math.max(0, daysWithEvents.length - MAX_DAYS))
</script>

<div class="calendar-tool-preview mt-1 min-w-0 max-w-full">
  <div class="calendar-tool-head mb-2 flex flex-wrap items-center gap-2 text-muted">
    <Calendar size={14} strokeWidth={2} aria-hidden="true" />
    <span class="calendar-tool-title text-xs font-semibold uppercase tracking-wide">{$t('cards.calendarPreviewCard.title')}</span>
    <span class="calendar-tool-meta ml-auto text-[11px] opacity-85">{start}{#if end !== start} – {end}{/if}</span>
  </div>

  {#if daysWithEvents.length === 0}
    <p class="calendar-tool-empty mb-1.5 text-xs text-muted">{$t('cards.calendarPreviewCard.emptyInRange')}</p>
  {:else}
    <div class="calendar-days-list flex flex-col gap-2.5">
      {#each displayDays as day (day.date)}
        <div class="day-group flex flex-col gap-1">
          <button
            type="button"
            class="day-header cursor-pointer border-none bg-transparent p-0 text-left text-[11px] font-semibold uppercase tracking-wide text-accent hover:underline"
            onclick={() => onOpenCalendar?.(day.date)}
          >{formatDayHeader(day.date)}</button>
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
      <p class="calendar-tool-more mt-2 text-[11px] text-muted">
        {$t('cards.calendarPreviewCard.moreDaysWithEvents', { count: hiddenCount })}
      </p>
    {/if}
  {/if}

  {#if onOpenCalendar}
    <button
      type="button"
      class="calendar-tool-full mt-2 cursor-pointer border-none bg-transparent p-0 text-left text-xs font-semibold text-accent hover:underline"
      onclick={() => onOpenCalendar(start)}
    >{$t('cards.calendarPreviewCard.openCalendar')}</button>
  {/if}
</div>
