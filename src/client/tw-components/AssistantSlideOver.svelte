<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import SlideOver from '@tw-components/shell/SlideOver.svelte'

  type SlideOverProps = ComponentProps<typeof SlideOver>
  type Props = Omit<SlideOverProps, 'mobilePanel'> & {
    variant: 'mobile' | 'desktop'
  }

  let {
    variant,
    overlay,
    surfaceContext,
    wikiRefreshKey,
    calendarRefreshKey,
    inboxTargetId,
    mailSearchResults,
    wikiStreamingWrite,
    wikiStreamingEdit,
    onWikiNavigate,
    onWikiDirNavigate,
    onOpenSharedWiki,
    onOpenSharedWikiFile,
    onInboxNavigate,
    onContextChange,
    onOpenSearch,
    onSummarizeInbox,
    onCalendarResetToToday,
    onCalendarNavigate,
    onClose,
    detailFullscreen,
    onToggleFullscreen,
    toolOnOpenFile,
    toolOnOpenIndexedFile,
    toolOnOpenEmail,
    toolOnOpenDraft,
    toolOnOpenFullInbox,
    toolOnOpenMessageThread,
    onOpenWikiAbout,
  }: Props = $props()

  let slide = $state<{ closeAnimated: () => void } | undefined>()

  export function closeAnimated() {
    slide?.closeAnimated()
  }
</script>

<SlideOver
  bind:this={slide}
  {overlay}
  surfaceContext={surfaceContext}
  {wikiRefreshKey}
  {calendarRefreshKey}
  {inboxTargetId}
  mailSearchResults={mailSearchResults}
  wikiStreamingWrite={wikiStreamingWrite}
  wikiStreamingEdit={wikiStreamingEdit}
  {onWikiNavigate}
  onWikiDirNavigate={onWikiDirNavigate}
  onOpenSharedWiki={onOpenSharedWiki}
  onOpenSharedWikiFile={onOpenSharedWikiFile}
  {onInboxNavigate}
  {onContextChange}
  {onOpenSearch}
  {onSummarizeInbox}
  {onCalendarResetToToday}
  {onCalendarNavigate}
  {onClose}
  mobilePanel={variant === 'mobile'}
  detailFullscreen={detailFullscreen}
  onToggleFullscreen={onToggleFullscreen}
  {toolOnOpenFile}
  toolOnOpenIndexedFile={toolOnOpenIndexedFile}
  {toolOnOpenEmail}
  {toolOnOpenDraft}
  {toolOnOpenFullInbox}
  {toolOnOpenMessageThread}
  {onOpenWikiAbout}
/>
