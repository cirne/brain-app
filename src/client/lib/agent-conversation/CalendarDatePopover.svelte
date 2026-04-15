<script lang="ts">
  import DayEvents from '../DayEvents.svelte'

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
</script>

<div
  class="date-popover"
  role="tooltip"
  style="left: {x}px; top: {y}px"
  onmouseenter={onKeep}
  onmouseleave={onStartClose}
>
  <div class="date-popover-header">
    {new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })}
  </div>
  <DayEvents {date} />
</div>

<style>
  .date-popover {
    position: fixed;
    z-index: 100;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    min-width: 240px;
    max-width: 320px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .date-popover-header {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 8px;
  }
</style>
