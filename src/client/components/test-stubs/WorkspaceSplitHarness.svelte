<script lang="ts">
  import WorkspaceSplit from '../WorkspaceSplit.svelte'

  type Props = {
    hasDetail?: boolean
    workspaceColumnWidthPx?: number
    desktopDetailOpen?: boolean
    onNavigateClear?: () => void
    detailFullscreen?: boolean
    chatText?: string
    detailText?: string
  }

  let {
    hasDetail = false,
    workspaceColumnWidthPx = 0,
    desktopDetailOpen = false,
    onNavigateClear = () => {},
    detailFullscreen = $bindable(false),
    chatText = 'Chat Content',
    detailText = 'Detail Content',
  }: Props = $props()

  let componentRef = $state<ReturnType<typeof WorkspaceSplit> | null>(null)

  export function getComponent() {
    return componentRef
  }
</script>

<WorkspaceSplit
  bind:this={componentRef}
  {hasDetail}
  workspaceColumnWidthPx={workspaceColumnWidthPx}
  {desktopDetailOpen}
  {onNavigateClear}
  bind:detailFullscreen
>
  {#snippet chat()}
    <div data-testid="chat-pane-content">{chatText}</div>
  {/snippet}
  {#snippet desktopDetail()}
    <div data-testid="detail-pane-content">{detailText}</div>
  {/snippet}
</WorkspaceSplit>
