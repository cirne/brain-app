<script lang="ts">
  import { RefreshCw } from 'lucide-svelte'

  type CalendarRow = { id: string; name: string }

  type Props = {
    sourceId: string
    /** Currently configured calendar IDs from source detail. */
    configuredIds: string[] | null
    onSaved: () => void
  }

  let { sourceId, configuredIds, onSaved }: Props = $props()

  let allCalendars = $state<CalendarRow[]>([])
  let loading = $state(false)
  let loadError = $state<string | null>(null)
  let selected = $state<Set<string>>(new Set())
  let saving = $state(false)
  let saveError = $state<string | null>(null)
  let savedAt = $state<number | null>(null)
  let dirty = $state(false)

  async function loadCalendars() {
    loading = true
    loadError = null
    try {
      const res = await fetch(`/api/hub/sources/calendars?id=${encodeURIComponent(sourceId)}`)
      const j = (await res.json()) as
        | { ok: true; allCalendars: CalendarRow[]; configuredIds: string[] }
        | { ok: false; error: string }
      if (!j.ok) {
        loadError = (j as { ok: false; error: string }).error ?? 'Could not load calendars'
        return
      }
      const d = j as { ok: true; allCalendars: CalendarRow[]; configuredIds: string[] }
      allCalendars = d.allCalendars

      // Use the server-side configuredIds from list-calendars if available,
      // otherwise fall back to the prop (from sources list).
      const base = d.configuredIds.length > 0 ? d.configuredIds : (configuredIds ?? ['primary'])
      selected = new Set(base)
      dirty = false
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Could not load calendars'
    } finally {
      loading = false
    }
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) {
      if (next.size <= 1) return // keep at least one
      next.delete(id)
    } else {
      next.add(id)
    }
    selected = next
    dirty = true
    saveError = null
  }

  async function save() {
    if (!dirty || saving) return
    saving = true
    saveError = null
    try {
      const res = await fetch('/api/hub/sources/update-calendar-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourceId, calendarIds: [...selected] }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not save')
      }
      dirty = false
      savedAt = Date.now()
      onSaved()
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Could not save'
    } finally {
      saving = false
    }
  }

  $effect(() => {
    sourceId
    void loadCalendars()
  })
</script>

<section class="hub-source-status-section" aria-labelledby="hub-cal-heading">
  <h2 id="hub-cal-heading" class="hub-source-status-heading">Calendars</h2>

  {#if loading && allCalendars.length === 0}
    <p class="hub-source-status-note" role="status">Loading calendars…</p>
  {:else if loadError}
    <p class="hub-source-status-err" role="alert">{loadError}</p>
  {:else if allCalendars.length === 0}
    <p class="hub-source-status-note">No calendars found. Sync first to discover available calendars.</p>
  {:else}
    <p class="hub-cal-hint">Choose which calendars to sync and show by default.</p>
    <ul class="hub-cal-list" role="list">
      {#each allCalendars as cal (cal.id)}
        {@const checked = selected.has(cal.id)}
        {@const isOnly = selected.size === 1 && checked}
        <li>
          <label class="hub-source-pref-row hub-cal-row">
            <input
              type="checkbox"
              checked={checked}
              disabled={isOnly}
              title={isOnly ? 'At least one calendar must be selected' : undefined}
              onchange={() => toggle(cal.id)}
            />
            <span class="hub-cal-name">{cal.name}</span>
          </label>
        </li>
      {/each}
    </ul>
    {#if saveError}
      <p class="hub-source-status-err" role="alert">{saveError}</p>
    {/if}
    <div class="hub-cal-actions">
      <button
        type="button"
        class="hub-dialog-btn hub-dialog-btn-primary hub-source-sync-btn"
        disabled={!dirty || saving}
        onclick={() => void save()}
      >
        {#if saving}
          <RefreshCw size={14} aria-hidden="true" class="hub-refresh-working" />
          Saving…
        {:else}
          Save
        {/if}
      </button>
      {#if savedAt && !dirty}
        <span class="hub-cal-saved">Saved</span>
      {/if}
    </div>
  {/if}
</section>

<style>
  .hub-cal-hint {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-2);
    line-height: 1.45;
  }

  .hub-cal-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .hub-cal-row {
    padding: 0.3rem 0;
  }

  .hub-cal-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text);
    line-height: 1.3;
  }

  .hub-cal-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.25rem;
  }

  .hub-cal-saved {
    font-size: 0.8125rem;
    color: var(--text-2);
  }
</style>
