<script lang="ts">
  type Props = {
    initialPath?: string
    onContextChange?: (_ctx: unknown) => void
  }
  let { initialPath }: Props = $props()
</script>

<div data-testid="file-viewer-stub">FileViewer: {initialPath ?? 'none'}</div>
