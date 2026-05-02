<script lang="ts">
  import CalendarPreviewCard from '@tw-components/cards/CalendarPreviewCard.svelte'
  import EditDiffPreviewCard from '@tw-components/cards/EditDiffPreviewCard.svelte'
  import WikiPreviewCard from '@tw-components/cards/WikiPreviewCard.svelte'
  import FilePreviewCard from '@tw-components/cards/FilePreviewCard.svelte'
  import IndexedFilePreviewCard from '@tw-components/cards/IndexedFilePreviewCard.svelte'
  import EmailPreviewCard from '@tw-components/cards/EmailPreviewCard.svelte'
  import InboxListPreviewCard from '@tw-components/cards/InboxListPreviewCard.svelte'
  import MessageThreadPreviewCard from '@tw-components/cards/MessageThreadPreviewCard.svelte'
  import MailSearchHitsPreviewCard from '@tw-components/cards/MailSearchHitsPreviewCard.svelte'
  import FindPersonHitsPreviewCard from '@tw-components/cards/FindPersonHitsPreviewCard.svelte'
  import FeedbackDraftPreviewCard from '@tw-components/cards/FeedbackDraftPreviewCard.svelte'
  import DraftPreviewCard from '@tw-components/cards/DraftPreviewCard.svelte'
  import type { ContentCardPreview } from '@client/lib/cards/contentCards.js'

  let {
    preview,
    onOpenWiki,
    onOpenFile,
    onOpenIndexedFile,
    onOpenEmail,
    onOpenDraft,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
  }: {
    preview: ContentCardPreview
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenIndexedFile?: (_id: string, _source?: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
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
  <WikiPreviewCard
    path={preview.path}
    excerpt={preview.excerpt}
    onOpen={() => onOpenWiki?.(preview.path)}
    onNavigateWiki={onOpenWiki}
  />
{:else if preview.kind === 'file'}
  <FilePreviewCard path={preview.path} excerpt={preview.excerpt} onOpen={() => onOpenFile?.(preview.path)} />
{:else if preview.kind === 'indexed-file'}
  <IndexedFilePreviewCard
    title={preview.title}
    sourceKind={preview.sourceKind}
    excerpt={preview.excerpt}
    onOpen={() => onOpenIndexedFile?.(preview.id, preview.source)}
  />
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
    returnedCount={preview.returnedCount}
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
    searchSource={preview.searchSource}
    {onOpenEmail}
    {onOpenIndexedFile}
  />
{:else if preview.kind === 'find_person_hits'}
  <FindPersonHitsPreviewCard queryLine={preview.queryLine} people={preview.people} />
{:else if preview.kind === 'feedback_draft'}
  <FeedbackDraftPreviewCard markdown={preview.markdown} />
{:else if preview.kind === 'email_draft'}
  <DraftPreviewCard
    draftId={preview.draftId}
    subject={preview.subject}
    snippet={preview.snippet}
    onOpen={() => onOpenDraft?.(preview.draftId, preview.subject)}
  />
{/if}
