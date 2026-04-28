<script lang="ts">
  type Props = {
    onClosePanel?: () => void
    onOpenWiki?: (_path?: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_chat: string, _label: string) => void
    onOpenWikiAbout?: () => void
  }
  // Stub accepts parent callback props for API compatibility; none are read.
  // eslint-disable-next-line no-empty-pattern -- intentional: all props optional
  let {}: Props = $props()
</script>

<div data-testid="hub-add-folders-stub">HubAddFoldersPanel</div>
