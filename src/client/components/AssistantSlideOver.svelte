<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import SlideOver from '@components/shell/SlideOver.svelte'

  type SlideOverProps = ComponentProps<typeof SlideOver>
  type Props = Omit<SlideOverProps, 'mobilePanel'> & {
    variant: 'mobile' | 'desktop'
    onMobileWikiOverlayBack?: SlideOverProps['onMobileWikiOverlayBack']
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
    onMobileWikiOverlayBack,
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
  onMobileWikiOverlayBack={variant === 'mobile' ? onMobileWikiOverlayBack : undefined}
/>
