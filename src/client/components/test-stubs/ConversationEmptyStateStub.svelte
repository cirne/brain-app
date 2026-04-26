<script lang="ts">
  let {
    onOpenEmail: _onOpenEmail,
    onOpenFullInbox: _onOpenFullInbox,
    onSwitchToCalendar: _onSwitchToCalendar,
    onOpenWikiAbout: _onOpenWikiAbout,
  }: {
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenWikiAbout?: () => void
  } = $props()
</script>

<div data-testid="conversation-empty-state">Empty conversation</div>
