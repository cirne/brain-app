<script lang="ts">
  import AgentChat from './AgentChat.svelte'

  /**
   * Leading `/drive` loads `assets/user-skills/drive/SKILL.md` (see POST /api/chat slash handling).
   */
  const ADD_DRIVE_KICKOFF =
    '/drive List my Google Drive (start from My Drive root or search) and recommend up to 5 folders or areas ' +
    'that would be good additions to my search index (work docs, project folders, etc.). ' +
    'Use google_drive_list / google_drive_search with my Gmail mailbox source id from manage_sources op=list. ' +
    'Present candidates as a numbered list (1–5). For each, give the Drive folder id (or explain root) and what would be indexed. ' +
    'When done, ask which numbers to add and wait for confirmation before calling manage_sources add with oauth_source_id and drive_folder_id.'

  const PLACEHOLDER =
    'Reply to confirm which Drive folders to add, adjust the list, or say no…'

  type Props = {
    onOpenWiki: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    onOpenWikiAbout?: () => void
  }

  let {
    onOpenWiki,
    onOpenFile,
    onOpenEmail,
    onOpenFullInbox,
    onSwitchToCalendar,
    onOpenMessageThread,
    onOpenWikiAbout,
  }: Props = $props()
</script>

<div
  class="hub-add-google-drive-panel flex min-h-0 min-w-0 flex-1 flex-col [&_.agent-chat]:min-h-0 [&_.agent-chat]:flex-1"
>
  <AgentChat
    context={{ type: 'chat' }}
    chatEndpoint="/api/chat"
    storageKey="brain-hub-add-google-drive"
    headerFallbackTitle="Add Google Drive to index"
    inputPlaceholder={PLACEHOLDER}
    autoSendMessage={ADD_DRIVE_KICKOFF}
    suppressAgentDetailAutoOpen={true}
    hidePaneContextChip={true}
    {onOpenWiki}
    {onOpenFile}
    {onOpenEmail}
    {onOpenFullInbox}
    {onSwitchToCalendar}
    {onOpenMessageThread}
    {onOpenWikiAbout}
  />
</div>
