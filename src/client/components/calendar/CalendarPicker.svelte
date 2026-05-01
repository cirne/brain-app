<script lang="ts">
  import { Check, RefreshCw } from 'lucide-svelte'

  import type {
    CalendarPickerCalendar,
    CalendarPickerLoadResult,
  } from './calendarPickerTypes.js'

  type Props = {
    /** Change this value to trigger a reload (e.g. hub source id). */
    reloadKey?: string | number | null
    /** Load calendars + server selection; called on mount and when `reloadKey` changes. */
    load: () => Promise<CalendarPickerLoadResult>
    /** Persist current selection. */
    save: (_calendarIds: string[]) => Promise<void>
    /**
     * When `load()` returns empty `configuredIds`, seed selection from this list
     * (e.g. parent detail snapshot).
     */
    fallbackConfiguredIds?: string[] | null
    /** Minimum calendars that must stay selected (default 1). */
    minSelected?: number
    hint?: string
    emptyMessage?: string
    loadingMessage?: string
    /** Extra classes on the Save button (e.g. hub-dialog-btn …). */
    primaryButtonClass?: string
    /** Class on RefreshCw while saving (e.g. hub spin utility). */
    savingIconClass?: string
    onSaved?: () => void
  }

  let {
    reloadKey = null,
    load,
    save,
    fallbackConfiguredIds = null,
    minSelected = 1,
    hint = 'Your calendars stay updated automatically. Choose which ones Braintunnel shows first in your schedule and when you chat about your calendar.',
    emptyMessage = 'No calendars found yet. Try refreshing once your calendar account has connected.',
    loadingMessage = 'Loading calendars…',
    primaryButtonClass = '',
    savingIconClass = '',
    onSaved,
  }: Props = $props()

  const pickerScope =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 12)
      : `cp-${Math.random().toString(36).slice(2, 14)}`

  let calendars = $state<CalendarPickerCalendar[]>([])
  let loading = $state(false)
  let loadError = $state<string | null>(null)
  let selected = $state<Set<string>>(new Set())
  let saving = $state(false)
  let saveError = $state<string | null>(null)
  let savedAt = $state<number | null>(null)
  let dirty = $state(false)

  function rowInputId(index: number): string {
    return `${pickerScope}-cal-${index}`
  }

  /** Stable alphabetical order by display name (locale-aware), then id. */
  function sortCalendarsAlphabetically(rows: CalendarPickerCalendar[]): CalendarPickerCalendar[] {
    return [...rows].sort((a, b) => {
      const na = (a.name ?? '').trim() || a.id
      const nb = (b.name ?? '').trim() || b.id
      const cmp = na.localeCompare(nb, undefined, { sensitivity: 'base', numeric: true })
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id)
    })
  }

  async function loadCalendars() {
    loading = true
    loadError = null
    try {
      const j = await load()
      calendars = sortCalendarsAlphabetically(j.allCalendars)

      const base =
        j.configuredIds.length > 0
          ? j.configuredIds
          : fallbackConfiguredIds?.length
            ? fallbackConfiguredIds
            : ['primary']

      selected = new Set(base.filter(Boolean))
      dirty = false
      saveError = null
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Could not load calendars'
    } finally {
      loading = false
    }
  }

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) {
      if (next.size <= minSelected) return
      next.delete(id)
    } else {
      next.add(id)
    }
    selected = next
    dirty = true
    saveError = null
  }

  async function commit() {
    if (!dirty || saving) return
    saving = true
    saveError = null
    try {
      await save([...selected])
      dirty = false
      savedAt = Date.now()
      onSaved?.()
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Could not save'
    } finally {
      saving = false
    }
  }

  $effect(() => {
    reloadKey
    void loadCalendars()
  })
</script>

<div class="cal-picker-root">
  {#if loading && calendars.length === 0}
    <p class="cal-picker-note" role="status">{loadingMessage}</p>
  {:else if loadError}
    <p class="cal-picker-err" role="alert">{loadError}</p>
  {:else if calendars.length === 0}
    <p class="cal-picker-note">{emptyMessage}</p>
  {:else}
    {#if hint}
      <p class="cal-picker-hint">{hint}</p>
    {/if}

    <ul class="cal-picker-list" role="list">
      {#each calendars as cal, i (cal.id)}
        {@const checked = selected.has(cal.id)}
        {@const isLocked = checked && selected.size <= minSelected}
        {@const hex = cal.color?.trim() ?? ''}
        {@const inputId = rowInputId(i)}
        <li class="cal-picker-li">
          <input
            id={inputId}
            type="checkbox"
            class="cal-picker-sr-input"
            checked={checked}
            disabled={isLocked}
            title={isLocked ? `At least ${minSelected} calendar(s) must stay selected` : undefined}
            onchange={() => toggle(cal.id)}
          />
          <label
            for={inputId}
            class="cal-picker-row"
            class:cal-picker-row--tinted={hex !== ''}
            style={hex !== '' ? `--cal-picker-accent: ${hex};` : undefined}
          >
            <span class="cal-picker-label-block">
              <span class="cal-picker-name">{cal.name}</span>
            </span>
            <span class="cal-picker-marker-track" aria-hidden="true">
              {#if checked}
                <span class="cal-picker-marker cal-picker-marker--on">
                  <Check size={15} strokeWidth={2.75} aria-hidden="true" />
                </span>
              {:else}
                <span class="cal-picker-marker cal-picker-marker--off"></span>
              {/if}
            </span>
          </label>
        </li>
      {/each}
    </ul>

    {#if saveError}
      <p class="cal-picker-err" role="alert">{saveError}</p>
    {/if}

    <div class="cal-picker-actions">
      <button
        type="button"
        class="cal-picker-save {primaryButtonClass}"
        disabled={!dirty || saving}
        onclick={() => void commit()}
      >
        {#if saving}
          <RefreshCw size={14} aria-hidden="true" class={savingIconClass} />
          Saving…
        {:else}
          Save
        {/if}
      </button>
      {#if savedAt && !dirty}
        <span class="cal-picker-saved">Saved</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cal-picker-root {
    width: 100%;
    box-sizing: border-box;
  }

  .cal-picker-hint {
    margin: 0 0 0.5rem;
    font-size: 0.8125rem;
    color: var(--text-2);
    line-height: 1.45;
  }

  .cal-picker-note {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-2);
    line-height: 1.45;
  }

  .cal-picker-err {
    margin: 0.35rem 0 0;
    font-size: 0.8125rem;
    color: var(--danger, #e11d48);
    line-height: 1.4;
  }

  .cal-picker-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 100%;
  }

  .cal-picker-li {
    margin: 0;
    padding: 0;
    width: 100%;
    min-width: 0;
  }

  /* Checkbox sits outside the visual row so the label is a single flex row without sr quirks */
  .cal-picker-sr-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  .cal-picker-li {
    position: relative;
  }

  .cal-picker-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    min-height: 2.75rem;
    box-sizing: border-box;
    margin: 0;
    padding: 0.55rem 0.75rem;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
    background: color-mix(in srgb, var(--bg-2, var(--bg)) 94%, var(--text));
    cursor: pointer;
    outline: none;
  }

  .cal-picker-li:has(.cal-picker-sr-input:focus-visible) .cal-picker-row {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .cal-picker-row--tinted {
    border-color: color-mix(in srgb, var(--cal-picker-accent) 38%, var(--border));
    background: color-mix(in srgb, var(--cal-picker-accent) 22%, var(--bg));
    box-shadow: inset 4px 0 0 var(--cal-picker-accent);
  }

  @supports (background: color-mix(in oklch, red, blue)) {
    .cal-picker-row--tinted {
      background: color-mix(in oklch, var(--cal-picker-accent) 28%, var(--bg));
      border-color: color-mix(in oklch, var(--cal-picker-accent) 34%, var(--border));
    }
  }

  .cal-picker-li:has(.cal-picker-sr-input:disabled) .cal-picker-row {
    opacity: 0.92;
    cursor: not-allowed;
  }

  .cal-picker-label-block {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    min-height: 1.35rem;
  }

  .cal-picker-name {
    display: block;
    width: 100%;
    font-size: 0.9375rem;
    font-weight: 600;
    line-height: 1.28;
    letter-spacing: -0.015em;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cal-picker-marker-track {
    flex-shrink: 0;
    width: 2.125rem;
    height: 2.125rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cal-picker-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.8125rem;
    height: 1.8125rem;
    border-radius: 999px;
    box-sizing: border-box;
  }

  .cal-picker-marker--on {
    background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--accent) 92%, white),
      var(--accent)
    );
    color: white;
    border: none;
    box-shadow:
      0 1px 2px color-mix(in srgb, var(--text) 22%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 35%, transparent);
  }

  .cal-picker-marker--off {
    border: 2px solid color-mix(in srgb, var(--text) 26%, transparent);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
  }

  .cal-picker-row--tinted .cal-picker-marker--off {
    border-color: color-mix(in srgb, var(--cal-picker-accent) 45%, var(--text));
    background: color-mix(in srgb, var(--cal-picker-accent) 12%, var(--bg));
  }

  .cal-picker-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.35rem;
  }

  .cal-picker-save:not(:global(.hub-dialog-btn)) {
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.45rem 0.85rem;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    background: var(--accent);
    color: white;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .cal-picker-save:not(:global(.hub-dialog-btn)):disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .cal-picker-save:not(:global(.hub-dialog-btn)):not(:disabled):hover {
    filter: brightness(1.06);
  }

  .cal-picker-saved {
    font-size: 0.8125rem;
    color: var(--text-2);
  }
</style>
