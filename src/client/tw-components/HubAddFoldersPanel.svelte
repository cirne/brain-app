<script lang="ts">
  // TODO(tw): switch to @tw-components when migrated
  import AgentChat from '@components/AgentChat.svelte'

  /**
   * Leading `/files` invokes the public `skills/files/SKILL.md` turn (see POST /api/chat slash handling)
   * so the model gets file-tool / filesystem context without the user typing `/files`.
   */
  const ADD_FOLDERS_KICKOFF =
    '/files Look through my Desktop and Documents folders for folders that would be good additions to my search index. ' +
    'Weed out poor fits (e.g. huge image-only archives, games, temp dirs). ' +
    'Recommend at most 5 candidates. Present them as a numbered list (1–5) so I can reply by number (e.g. “add 1, 3, and 4”). ' +
    'For each item, say what would be indexed: unless I should exclude certain file types or subdirectories, assume the whole tree under that folder path, including all subdirectories. ' +
    'If only part of a folder should be indexed (specific subdirs, or skip certain extensions), say that explicitly. ' +
    'When done, ask which numbers to add and wait for my confirmation before changing any indexing settings.'

  const PLACEHOLDER =
    'Reply to confirm which folders to add, adjust the list, or say no…'

  type Props = {
    /** Same as slide-over close (X / mobile back): used when the agent calls `finish_conversation`. */
    onClosePanel: () => void
    onOpenWiki: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    onOpenWikiAbout?: () => void
  }

  let {
    onClosePanel,
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenDraft,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    onOpenWikiAbout,
  }: Props = $props()
</script>

<div
  class="flex min-h-0 min-w-0 flex-1 flex-col [&_.agent-chat]:min-h-0 [&_.agent-chat]:flex-1"
>
  <AgentChat
    context={{ type: 'chat' }}
    chatEndpoint="/api/chat"
    storageKey="brain-hub-add-folders"
    headerFallbackTitle="Add folders to index"
    inputPlaceholder={PLACEHOLDER}
    autoSendMessage={ADD_FOLDERS_KICKOFF}
    suppressAgentDetailAutoOpen={true}
    hidePaneContextChip={true}
    onConversationFinishedByAgent={onClosePanel}
    {onOpenWiki}
    {onOpenFile}
    {onOpenEmail}
    {onOpenDraft}
    {onOpenFullInbox}
    {onSwitchToCalendar}
    {onOpenMessageThread}
    {onOpenWikiAbout}
  />
</div>
