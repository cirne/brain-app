<script lang="ts">
  // TODO(tw): switch to @tw-components when migrated
  import CalendarPicker from '@components/calendar/CalendarPicker.svelte'
  // TODO(tw): switch to @tw-components when migrated
  import type {
    CalendarPickerCalendar,
    CalendarPickerLoadResult,
  } from '@components/calendar/calendarPickerTypes.js'

  type Props = {
    sourceId: string
    /** Currently configured calendar IDs from source detail. */
    configuredIds: string[] | null
    onSaved: () => void
  }

  let { sourceId, configuredIds, onSaved }: Props = $props()

  async function loadHubCalendars(): Promise<CalendarPickerLoadResult> {
    const res = await fetch(`/api/hub/sources/calendars?id=${encodeURIComponent(sourceId)}`)
    const j = (await res.json()) as
      | { ok: true; allCalendars: CalendarPickerCalendar[]; configuredIds: string[] }
      | { ok: false; error: string }
    if (!j.ok) {
      throw new Error((j as { ok: false; error: string }).error ?? 'Could not load calendars')
    }
    const d = j as {
      ok: true
      allCalendars: CalendarPickerCalendar[]
      configuredIds: string[]
    }
    return {
      allCalendars: d.allCalendars,
      configuredIds: d.configuredIds,
    }
  }

  async function saveHubCalendars(calendarIds: string[]): Promise<void> {
    const res = await fetch('/api/hub/sources/update-calendar-ids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sourceId, calendarIds }),
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || !j.ok) {
      throw new Error(typeof j.error === 'string' ? j.error : 'Could not save')
    }
  }
</script>

<section
  class="hub-source-status-section flex flex-col gap-[0.65rem] border-t border-[color-mix(in_srgb,var(--border)_50%,transparent)] pt-[0.85rem]"
  aria-labelledby="hub-cal-heading"
>
  <h2
    id="hub-cal-heading"
    class="hub-source-status-heading m-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted"
  >
    Calendars
  </h2>

  <CalendarPicker
    reloadKey={sourceId}
    load={loadHubCalendars}
    save={saveHubCalendars}
    fallbackConfiguredIds={configuredIds}
    onSaved={() => onSaved()}
    primaryButtonClass="hub-dialog-btn hub-dialog-btn-primary hub-source-sync-btn"
    savingIconClass="hub-refresh-working"
  />
</section>
