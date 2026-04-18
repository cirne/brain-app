<script lang="ts">
  import CalendarPreviewCard from '../cards/CalendarPreviewCard.svelte'
  import EditDiffPreviewCard from '../cards/EditDiffPreviewCard.svelte'
  import WikiPreviewCard from '../cards/WikiPreviewCard.svelte'
  import FilePreviewCard from '../cards/FilePreviewCard.svelte'
  import EmailPreviewCard from '../cards/EmailPreviewCard.svelte'
  import InboxListPreviewCard from '../cards/InboxListPreviewCard.svelte'
  import MessageThreadPreviewCard from '../cards/MessageThreadPreviewCard.svelte'
  import MailSearchHitsPreviewCard from '../cards/MailSearchHitsPreviewCard.svelte'
  import FindPersonHitsPreviewCard from '../cards/FindPersonHitsPreviewCard.svelte'
  import type { ContentCardPreview } from '../cards/contentCards.js'

  let {
    preview,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
  }: {
    preview: ContentCardPreview
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
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
{:else if preview.kind === 'file'}
  <FilePreviewCard path={preview.path} excerpt={preview.excerpt} onOpen={() => onOpenFile?.(preview.path)} />
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
{:else if preview.kind === 'message_thread'}
  <MessageThreadPreviewCard
    displayChat={preview.displayChat}
    snippet={preview.snippet}
    previewMessages={preview.previewMessages}
    total={preview.total}
    n={preview.n}
    person={preview.person}
    onOpen={() => onOpenMessageThread?.(preview.canonicalChat, preview.displayChat)}
  />
{:else if preview.kind === 'wiki_edit_diff'}
  <EditDiffPreviewCard path={preview.path} unified={preview.unified} onOpen={() => onOpenWiki?.(preview.path)} />
{:else if preview.kind === 'mail_search_hits'}
  <MailSearchHitsPreviewCard
    queryLine={preview.queryLine}
    items={preview.items}
    totalMatched={preview.totalMatched}
    onOpenEmail={onOpenEmail}
  />
{:else if preview.kind === 'find_person_hits'}
  <FindPersonHitsPreviewCard queryLine={preview.queryLine} people={preview.people} />
{/if}
