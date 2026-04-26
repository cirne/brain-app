<script lang="ts">
  let {
    isMobile: _isMobile = false,
    sidebarOpen: _sidebarOpen = false,
    onToggleSidebar: _onToggleSidebar = () => {},
    syncErrors: _syncErrors = [],
    showSyncErrors: _showSyncErrors = false,
    onOpenSearch: _onOpenSearch = () => {},
    onToggleSyncErrors: _onToggleSyncErrors = () => {},
    onOpenHub: _onOpenHub = () => {},
    onNewChat: _onNewChat = () => {},
    isEmptyChat: _isEmptyChat = true,
    hostedHandlePill: _hostedHandlePill = undefined,
    onHostedHandleNavigate: _onHostedHandleNavigate = () => {},
  }: {
    isMobile?: boolean
    sidebarOpen?: boolean
    onToggleSidebar?: () => void
    syncErrors?: string[]
    showSyncErrors?: boolean
    onOpenSearch?: () => void
    onToggleSyncErrors?: () => void
    onOpenHub?: () => void
    onNewChat?: () => void
    isEmptyChat?: boolean
    hostedHandlePill?: string
    onHostedHandleNavigate?: () => void
  } = $props()
</script>

<div data-testid="app-top-nav-stub" class="app-top-nav-stub">AppTopNav</div>
