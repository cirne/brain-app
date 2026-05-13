<script lang="ts">
  import type { ChatMessage } from '@client/lib/agentUtils.js'

  let {
    msg,
    streaming: _streaming = false,
    isLastMessage = false,
    isLastAssistantInThread = false,
    toolDisplayMode: _toolDisplayMode = 'focused',
  }: {
    msg: ChatMessage
    streaming?: boolean
    isLastMessage?: boolean
    isLastAssistantInThread?: boolean
    onOpenWiki?: (_path: string) => void
    onOpenFile?: (_path: string) => void
    onOpenEmail?: (_threadId: string, _subject?: string, _from?: string) => void
    onOpenDraft?: (_draftId: string, _subject?: string) => void
    onOpenFullInbox?: () => void
    onSwitchToCalendar?: (_date: string, _eventId?: string) => void
    onOpenMessageThread?: (_canonicalChat: string, _displayLabel: string) => void
    toolDisplayMode?: 'compact' | 'detailed' | 'focused'
  } = $props()
</script>

<div
  data-testid="chat-message-row"
  data-role={msg.role}
  data-last-message={isLastMessage}
  data-last-assistant={isLastAssistantInThread}
  data-tool-display-mode={_toolDisplayMode}
>
  {msg.content ?? ''}
</div>
