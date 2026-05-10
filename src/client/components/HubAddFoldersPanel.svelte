<script lang="ts">
  import AgentChat from '@components/AgentChat.svelte'
  import { t } from '@client/lib/i18n/index.js'

  /**
   * Leading `/files` invokes the public `skills/files/SKILL.md` turn (see POST /api/chat slash handling)
   * so the model gets file-tool / filesystem context without the user typing `/files`.
   */
  const addFoldersKickoff = $derived($t('hub.hubAddFoldersPanel.kickoffMessage'))
  const placeholder = $derived($t('hub.hubAddFoldersPanel.placeholder'))

  type Props = {
    /** Same as slide-over close (X / mobile back): used when the agent completes `finish_conversation`. */
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
    headerFallbackTitle={$t('hub.hubAddFoldersPanel.headerFallbackTitle')}
    inputPlaceholder={placeholder}
    autoSendMessage={addFoldersKickoff}
    suppressAgentDetailAutoOpen={true}
    hidePaneContextChip={true}
    onAgentFinishConversation={onClosePanel}
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
