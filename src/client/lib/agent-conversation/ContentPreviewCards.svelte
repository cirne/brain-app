<script lang="ts">
  import CalendarPreviewCard from '../cards/CalendarPreviewCard.svelte'
  import EditDiffPreviewCard from '../cards/EditDiffPreviewCard.svelte'
  import WikiPreviewCard from '../cards/WikiPreviewCard.svelte'
  import EmailPreviewCard from '../cards/EmailPreviewCard.svelte'
  import InboxListPreviewCard from '../cards/InboxListPreviewCard.svelte'
  import ImessageThreadPreviewCard from '../cards/ImessageThreadPreviewCard.svelte'
  import type { ContentCardPreview } from '../cards/contentCards.js'

  let {
    preview,
    onOpenWiki,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenImessage,
  }: {
    preview: ContentCardPreview
    onOpenWiki?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenImessage?: (_canonicalChat: string, _displayLabel: string) => void
  } = $props()
</script>

{#if preview.kind === 'calendar'}
  <CalendarPreviewCard
    start={preview.start}
    end={preview.end}
    events={preview.events}
    onOpenCalendar={(date) => onSwitchToCalendar?.(date)}
    onOpenCalendarEvent={(date, eventId) => onSwitchToCalendar?.(date, eventId)}
  />
{:else if preview.kind === 'wiki'}
  <WikiPreviewCard path={preview.path} excerpt={preview.excerpt} onOpen={() => onOpenWiki?.(preview.path)} />
{:else if preview.kind === 'email'}
  <EmailPreviewCard
    subject={preview.subject}
    from={preview.from}
    snippet={preview.snippet}
    onOpen={() => onOpenEmail?.(preview.id, preview.subject, preview.from)}
  />
{:else if preview.kind === 'inbox_list'}
  <InboxListPreviewCard
    items={preview.items}
    totalCount={preview.totalCount}
    onOpenEmail={(id, subject, from) => onOpenEmail?.(id, subject, from)}
    onOpenFullInbox={onOpenFullInbox}
  />
{:else if preview.kind === 'imessage_thread'}
  <ImessageThreadPreviewCard
    displayChat={preview.displayChat}
    snippet={preview.snippet}
    previewMessages={preview.previewMessages}
    total={preview.total}
    n={preview.n}
    person={preview.person}
    onOpen={() => onOpenImessage?.(preview.canonicalChat, preview.displayChat)}
  />
{:else if preview.kind === 'wiki_edit_diff'}
  <EditDiffPreviewCard path={preview.path} unified={preview.unified} onOpen={() => onOpenWiki?.(preview.path)} />
{/if}
