<script lang="ts">
  import CalendarPicker from '../calendar/CalendarPicker.svelte'
  import type {
    CalendarPickerCalendar,
    CalendarPickerLoadResult,
  } from '../calendar/calendarPickerTypes.js'

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

<section class="hub-source-status-section" aria-labelledby="hub-cal-heading">
  <h2 id="hub-cal-heading" class="hub-source-status-heading">Calendars</h2>

  <CalendarPicker
    reloadKey={sourceId}
    load={loadHubCalendars}
    save={saveHubCalendars}
    fallbackConfiguredIds={configuredIds}
    onSaved={() => onSaved()}
    primaryButtonclass="hub-dialog-btn hub-dialog-btn-primary hub-source-sync-btn"
    savingIconclass="hub-refresh-working"
  />
</section>
