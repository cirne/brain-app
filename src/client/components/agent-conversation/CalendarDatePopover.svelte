<script lang="ts">
  import i18next from 'i18next'
  import DayEvents from '@components/DayEvents.svelte'

  let {
    date,
    x,
    y,
    onKeep,
    onStartClose,
  }: {
    date: string
    x: number
    y: number
    onKeep: () => void
    onStartClose: () => void
  } = $props()

  const headingDate = $derived(
    new Date(`${date}T00:00:00`).toLocaleDateString(i18next.language || undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
  )
</script>

<div
  class="date-popover fixed z-[100] min-w-60 max-w-80 border border-border bg-surface-3 p-2.5 px-3 shadow-[0_8px_24px_rgba(0,0,0,0.4)] [font:inherit]"
  role="tooltip"
  style="left: {x}px; top: {y}px"
  onmouseenter={onKeep}
  onmouseleave={onStartClose}
>
  <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted [font-variant:normal]">
    {headingDate}
  </div>
  <DayEvents {date} />
</div>
