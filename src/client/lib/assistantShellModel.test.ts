import { describe, expect, it } from 'vitest'
import type { SurfaceContext } from '@client/router.js'
import type { AssistantShellState } from './assistantShellModel.js'
import { alignShellWithBareChatRoute } from './assistantShellModel.js'

function minimalShell(overrides: Partial<AssistantShellState> = {}): AssistantShellState {
  const base = {
    route: {},
    syncErrors: [],
    showSyncErrors: false,
    calendarRefreshKey: 0,
    wikiRefreshKey: 0,
    showSearch: false,
    inboxTargetId: undefined as string | undefined,
    wikiWriteStreaming: null as { path: string; body: string } | null,
    wikiEditStreaming: null as { path: string; toolId: string } | null,
    chatIsEmpty: true,
    hostedHandleNav: undefined as string | undefined,
    sidebarOpen: false,
    activeSessionId: null as string | null,
    streamingSessionIds: new Set<string>(),
    chatTitleForUrl: null as string | null,
    resolvedTailSessionId: null as string | null,
    reduceSidebarMotion: false,
    agentContext: { type: 'chat' } as SurfaceContext,
    detailPaneFullscreen: false,
    isMobile: false,
    workspaceColumnWidth: 0,
    pendingWikiShareInvitesCount: 0,
    ...overrides,
  }
  return base as AssistantShellState
}

describe('alignShellWithBareChatRoute', () => {
  it('drops wiki surface context so placeholders match bare /c', () => {
    const shell = minimalShell()
    shell.agentContext = { type: 'wiki', path: 'notes/x.md', title: 'Notes' }
    shell.inboxTargetId = 'msg-99'
    shell.wikiWriteStreaming = { path: 'a.md', body: '#' }
    shell.wikiEditStreaming = { path: 'b.md', toolId: 't1' }

    alignShellWithBareChatRoute(shell)

    expect(shell.agentContext).toEqual({ type: 'chat' })
    expect(shell.inboxTargetId).toBeUndefined()
    expect(shell.wikiWriteStreaming).toBeNull()
    expect(shell.wikiEditStreaming).toBeNull()
  })
})
