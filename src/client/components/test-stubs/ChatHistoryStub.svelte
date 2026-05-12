<script lang="ts">
  let {
    activeSessionId: _activeSessionId = null,
    streamingSessionIds: _streamingSessionIds = new Set(),
    onSelect: _onSelect = () => {},
    onSelectDoc: _onSelectDoc = () => {},
    onNewChat: _onNewChat = () => {},
    onOpenAllChats: _onOpenAllChats = () => {},
  }: {
    activeSessionId?: string | null
    streamingSessionIds?: ReadonlySet<string>
    onSelect?: (_id: string, _title?: string) => void
    onSelectDoc?: (_path: string) => void
    onNewChat?: () => void
    onOpenAllChats?: () => void
  } = $props()

  export function refresh(_opts?: { background?: boolean }): Promise<void> {
    return Promise.resolve()
  }
</script>

<div data-testid="chat-history-stub" class="chat-history-stub">ChatHistory</div>
