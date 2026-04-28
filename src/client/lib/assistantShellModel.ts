import { parseRoute, type Route, type SurfaceContext } from '@client/router.js'

/**
 * Route URL bar + sync + overlays + layout measurements for the Assistant shell.
 * Lives in one `$state` blob so the component script opens with a factory call instead of dozens of `let`s.
 */
export type AssistantShellState = {
  route: Route
  syncErrors: string[]
  showSyncErrors: boolean
  calendarRefreshKey: number
  wikiRefreshKey: number
  showSearch: boolean
  inboxTargetId: string | undefined
  wikiWriteStreaming: { path: string; body: string } | null
  wikiEditStreaming: { path: string; toolId: string } | null
  chatIsEmpty: boolean
  hostedHandleNav: string | undefined
  sidebarOpen: boolean
  activeSessionId: string | null
  streamingSessionIds: ReadonlySet<string>
  chatTitleForUrl: string | null
  resolvedTailSessionId: string | null
  reduceSidebarMotion: boolean
  agentContext: SurfaceContext
  detailPaneFullscreen: boolean
  isMobile: boolean
  workspaceColumnWidth: number
}

export function createAssistantShellState(): AssistantShellState {
  return {
    route: parseRoute(),
    syncErrors: [],
    showSyncErrors: false,
    calendarRefreshKey: 0,
    wikiRefreshKey: 0,
    showSearch: false,
    inboxTargetId: undefined,
    wikiWriteStreaming: null,
    wikiEditStreaming: null,
    chatIsEmpty: true,
    hostedHandleNav: undefined,
    sidebarOpen: false,
    activeSessionId: null,
    streamingSessionIds: new Set(),
    chatTitleForUrl: null,
    resolvedTailSessionId: null,
    reduceSidebarMotion: false,
    agentContext: { type: 'chat' },
    detailPaneFullscreen: false,
    isMobile: false,
    workspaceColumnWidth: 0,
  }
}
