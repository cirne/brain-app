<script lang="ts">
  import { Check, RefreshCw } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'

  import type {
    CalendarPickerCalendar,
    CalendarPickerLoadResult,
  } from '@client/lib/calendar/calendarPickerTypes.js'
  import { t } from '@client/lib/i18n/index.js'

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
    onSaved?: () => void
  }

  let {
    reloadKey = null,
    load,
    save,
    fallbackConfiguredIds = null,
    minSelected = 1,
    hint,
    emptyMessage,
    loadingMessage,
    onSaved,
  }: Props = $props()

  const resolvedHint = $derived(hint ?? $t('hub.calendarPicker.hint'))
  const resolvedEmptyMessage = $derived(emptyMessage ?? $t('hub.calendarPicker.empty'))
  const resolvedLoadingMessage = $derived(loadingMessage ?? $t('hub.calendarPicker.loading'))

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
  /** When true, run persist again after the in-flight save finishes (latest selection wins). */
  let persistQueued = $state(false)

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
      loadError = e instanceof Error ? e.message : $t('hub.calendarPicker.errors.load')
    } finally {
      loading = false
    }
  }

  async function persistSelection() {
    if (loading) return
    if (saving) {
      persistQueued = true
      return
    }
    saving = true
    saveError = null
    try {
      await save([...selected])
      dirty = false
      savedAt = Date.now()
      onSaved?.()
    } catch (e) {
      saveError = e instanceof Error ? e.message : $t('hub.calendarPicker.errors.save')
    } finally {
      saving = false
      if (persistQueued) {
        persistQueued = false
        void persistSelection()
      }
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
    void persistSelection()
  }

  $effect(() => {
    reloadKey
    void loadCalendars()
  })
</script>

<div class="cal-picker-root box-border w-full">
  {#if loading && calendars.length === 0}
    <p class="cal-picker-note m-0 text-[0.8125rem] leading-[1.45] text-muted" role="status">{resolvedLoadingMessage}</p>
  {:else if loadError}
    <p class="cal-picker-err mt-[0.35rem] text-[0.8125rem] leading-[1.4] text-danger" role="alert">{loadError}</p>
  {:else if calendars.length === 0}
    <p class="cal-picker-note m-0 text-[0.8125rem] leading-[1.45] text-muted">{resolvedEmptyMessage}</p>
  {:else}
    {#if resolvedHint}
      <p class="cal-picker-hint mb-2 mt-0 text-[0.8125rem] leading-[1.45] text-muted">{resolvedHint}</p>
    {/if}

    <ul class="cal-picker-list m-0 flex w-full list-none flex-col gap-[0.4rem] p-0" role="list">
      {#each calendars as cal, i (cal.id)}
        {@const checked = selected.has(cal.id)}
        {@const isLocked = checked && selected.size <= minSelected}
        {@const hex = cal.color?.trim() ?? ''}
        {@const inputId = rowInputId(i)}
        <li class="cal-picker-li relative m-0 w-full min-w-0 p-0">
          <input
            id={inputId}
            type="checkbox"
            class="cal-picker-sr-input absolute m-[-1px] h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]"
            {checked}
            disabled={isLocked}
            title={isLocked
              ? $t('hub.calendarPicker.minSelectedTitle', { count: minSelected })
              : undefined}
            onchange={() => toggle(cal.id)}
          />
          <label
            for={inputId}
            class={cn(
              'cal-picker-row m-0 box-border flex min-h-[2.35rem] w-full cursor-pointer items-center justify-between gap-[0.65rem] border border-[color-mix(in_srgb,var(--border)_88%,transparent)] bg-[color-mix(in_srgb,var(--bg-2,var(--bg))_94%,var(--text))] p-[0.4rem_0.65rem] outline-none',
              hex !== '' && 'cal-picker-row--tinted',
            )}
            style={hex !== '' ? `--cal-picker-accent: ${hex};` : undefined}
          >
            <span class="cal-picker-label-block flex min-h-[1.2rem] min-w-0 flex-1 items-center">
              <span
                class="cal-picker-name block w-full overflow-hidden text-ellipsis whitespace-nowrap text-[0.9375rem] font-semibold leading-[1.28] tracking-[-0.015em] text-foreground"
              >{cal.name}</span>
            </span>
            <span class="cal-picker-marker-track flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden="true">
              {#if checked}
                <span
                  class="cal-picker-marker cal-picker-marker--on box-border inline-flex h-6 w-6 items-center justify-center border-none text-accent-foreground [background:linear-gradient(145deg,color-mix(in_srgb,var(--accent)_92%,white),var(--accent))] [box-shadow:0_1px_2px_color-mix(in_srgb,var(--text)_22%,transparent),inset_0_1px_0_color-mix(in_srgb,white_35%,transparent)]"
                >
                  <Check size={12} strokeWidth={2.5} aria-hidden="true" />
                </span>
              {:else}
                <span
                  class="cal-picker-marker cal-picker-marker--off box-border inline-flex h-6 w-6 items-center justify-center border-2 border-[color-mix(in_srgb,var(--text)_26%,transparent)] bg-[color-mix(in_srgb,var(--bg)_55%,transparent)]"
                ></span>
              {/if}
            </span>
          </label>
        </li>
      {/each}
    </ul>

    {#if saveError}
      <p class="cal-picker-err mt-[0.35rem] text-[0.8125rem] leading-[1.4] text-danger" role="alert">{saveError}</p>
    {/if}

    <div
      class="cal-picker-status mt-[0.35rem] flex min-h-[1.35rem] items-center gap-2 text-[0.8125rem] text-muted"
      aria-live="polite"
    >
      {#if saving}
        <RefreshCw size={14} aria-hidden="true" class="cal-picker-saving-spin shrink-0" />
        <span>{$t('common.status.saving')}</span>
      {:else if savedAt && !dirty && !saveError}
        <span class="cal-picker-saved">{$t('common.status.saved')}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Tints/outlines that depend on cross-element :has() / pseudo-class state. */
  .cal-picker-li:has(.cal-picker-sr-input:focus-visible) .cal-picker-row {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .cal-picker-li:has(.cal-picker-sr-input:disabled) .cal-picker-row {
    opacity: 0.92;
    cursor: not-allowed;
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

  .cal-picker-row--tinted .cal-picker-marker--off {
    border-color: color-mix(in srgb, var(--cal-picker-accent) 45%, var(--text));
    background: color-mix(in srgb, var(--cal-picker-accent) 12%, var(--bg));
  }

  .cal-picker-saving-spin {
    animation: cal-picker-spin 0.85s linear infinite;
  }

  @keyframes cal-picker-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
