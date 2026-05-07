<script lang="ts">
  /** Minimal stub used by Vitest in YourWikiDetail / hub agent panel tests. */
  type Props = {
    id?: string | undefined
    embedInHubDetail?: boolean
    embedScrollParent?: HTMLElement | undefined
    alwaysScrollToBottom?: boolean
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenIndexedFile?: (_id: string, _source?: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
  }
  let { id }: Props = $props()
</script>

<div data-testid="background-agent-panel-stub" data-id={id ?? ''}></div>
