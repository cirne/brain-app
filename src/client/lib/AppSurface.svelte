<script lang="ts">
  import Wiki from './Wiki.svelte'
  import Inbox from './Inbox.svelte'
  import Calendar from './Calendar.svelte'
  import Home from './Home.svelte'
  import { navigate, type Route, type SurfaceContext } from '../router.js'

  type Props = {
    route: Route
    wikiRefreshKey: number
    calendarRefreshKey: number
    inboxTargetId: string | undefined
    dirtyFiles: string[]
    recentFiles: { path: string; date: string }[]
    onOpenWiki: (_path: string) => void
    onInboxNavigate: (_id: string | undefined) => void
    onContextChange: (_ctx: SurfaceContext) => void
    onOpenSearch: () => void
    onRouteChange: (_r: Route) => void
    onSummarizeInbox: (_message: string) => void
  }

  let {
    route,
    wikiRefreshKey,
    calendarRefreshKey,
    inboxTargetId,
    dirtyFiles,
    recentFiles,
    onOpenWiki,
    onInboxNavigate,
    onContextChange,
    onOpenSearch,
    onRouteChange,
    onSummarizeInbox,
  }: Props = $props()
</script>

{#if route.tab === 'today'}
  <Home
    onOpenWiki={onOpenWiki}
    onOpenInbox={(id) => onInboxNavigate(id)}
    dirty={dirtyFiles}
    recent={recentFiles}
    onContextChange={onContextChange}
  />
{:else if route.tab === 'wiki'}
  <Wiki
    initialPath={route.path}
    refreshKey={wikiRefreshKey}
    onNavigate={(path) => {
      if (path) {
        const next: Route = { tab: 'wiki', path }
        navigate(next)
        onRouteChange(next)
      }
    }}
    onContextChange={onContextChange}
  />
{:else if route.tab === 'calendar'}
  <Calendar
    refreshKey={calendarRefreshKey}
    initialDate={route.date}
    onContextChange={onContextChange}
  />
{:else}
  <Inbox
    initialId={route.id}
    targetId={inboxTargetId}
    onNavigate={onInboxNavigate}
    onContextChange={onContextChange}
    onOpenSearch={onOpenSearch}
    onSummarizeInbox={onSummarizeInbox}
  />
{/if}
