<script lang="ts">
  let {
    activeSessionId: _activeSessionId = null,
    streamingSessionIds: _streamingSessionIds = new Set(),
    onSelectSession: _onSelectSession = () => {},
    onNewChat: _onNewChat = () => {},
  }: {
    activeSessionId?: string | null
    streamingSessionIds?: ReadonlySet<string>
    onSelectSession?: (_id: string, _title?: string) => void
    onNewChat?: () => void
  } = $props()
</script>

<div data-testid="chat-history-page-stub" class="chat-history-page-stub">ChatHistoryPage</div>
