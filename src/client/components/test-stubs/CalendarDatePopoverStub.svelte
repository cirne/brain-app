<script lang="ts">
  let {
    date,
    x: _x,
    y: _y,
    onKeep,
    onStartClose,
  }: {
    date: string
    x: number
    y: number
    onKeep?: () => void
    onStartClose?: () => void
  } = $props()
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  data-testid="calendar-date-popover"
  data-date={date}
  onmouseenter={() => onKeep?.()}
  onmouseleave={() => onStartClose?.()}
>
  Popover for {date}
</div>
