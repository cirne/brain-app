<script lang="ts">
  type Props = {
    refreshKey?: number
    initialDate?: string
    initialEventId?: string
    onResetToToday?: () => void
    onCalendarNavigate?: (_date: string, _eventId?: string) => void
    onContextChange?: (_ctx: unknown) => void
    onOpenWiki?: (_path?: string) => void
    onOpenEmail?: (_id?: string) => void
  }
  let { initialDate }: Props = $props()
</script>

<div data-testid="calendar-stub">Calendar: {initialDate ?? 'today'}</div>
