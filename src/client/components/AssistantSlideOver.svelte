<script lang="ts">
  import type { ComponentProps } from 'svelte'
  import SlideOver from './shell/SlideOver.svelte'

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
    toolOnOpenEmail,
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
  {toolOnOpenEmail}
  {toolOnOpenFullInbox}
  {toolOnOpenMessageThread}
  {onOpenWikiAbout}
/>
