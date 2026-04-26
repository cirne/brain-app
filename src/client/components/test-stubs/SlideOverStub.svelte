<script lang="ts">
  import type { Overlay, SurfaceContext } from '@client/router.js'

  let {
    overlay: _overlay = undefined,
    surfaceContext: _surfaceContext = undefined,
    wikiRefreshKey: _wikiRefreshKey = 0,
    calendarRefreshKey: _calendarRefreshKey = 0,
    inboxTargetId: _inboxTargetId = undefined,
    wikiStreamingWrite: _wikiStreamingWrite = null,
    wikiStreamingEdit: _wikiStreamingEdit = null,
    onWikiNavigate: _onWikiNavigate = () => {},
    onWikiDirNavigate: _onWikiDirNavigate = () => {},
    onInboxNavigate: _onInboxNavigate = () => {},
    onContextChange: _onContextChange = () => {},
    onOpenSearch: _onOpenSearch = () => {},
    onSummarizeInbox: _onSummarizeInbox = () => {},
    onCalendarResetToToday: _onCalendarResetToToday = () => {},
    onCalendarNavigate: _onCalendarNavigate = () => {},
    toolOnOpenFile: _toolOnOpenFile = () => {},
    toolOnOpenEmail: _toolOnOpenEmail = () => {},
    toolOnOpenFullInbox: _toolOnOpenFullInbox = () => {},
    toolOnOpenMessageThread: _toolOnOpenMessageThread = () => {},
    onOpenWikiAbout: _onOpenWikiAbout = () => {},
    onClose: _onClose = () => {},
    mobilePanel: _mobilePanel = false,
    detailFullscreen: _detailFullscreen = false,
    onToggleFullscreen: _onToggleFullscreen = () => {},
  }: {
    overlay?: Overlay
    surfaceContext?: SurfaceContext
    wikiRefreshKey?: number
    calendarRefreshKey?: number
    inboxTargetId?: string
    wikiStreamingWrite?: { path: string; body: string } | null
    wikiStreamingEdit?: { path: string; toolId: string } | null
    onWikiNavigate?: (_path?: string) => void
    onWikiDirNavigate?: (_path?: string) => void
    onInboxNavigate?: (_id?: string) => void
    onContextChange?: (_ctx: SurfaceContext) => void
    onOpenSearch?: () => void
    onSummarizeInbox?: (_message: string) => void
    onCalendarResetToToday?: () => void
    onCalendarNavigate?: (_date: string, _eventId?: string) => void
    toolOnOpenFile?: (_path: string) => void
    toolOnOpenEmail?: (_id: string, _subject?: string, _from?: string) => void
    toolOnOpenFullInbox?: () => void
    toolOnOpenMessageThread?: (_chat: string, _label: string) => void
    onOpenWikiAbout?: () => void
    onClose?: () => void
    mobilePanel?: boolean
    detailFullscreen?: boolean
    onToggleFullscreen?: () => void
  } = $props()

  export function closeAnimated() {}
</script>

<div data-testid="slide-over-stub" class="slide-over-stub">SlideOver</div>
