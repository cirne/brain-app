<script lang="ts">
  type Props = {
    initialPath?: string
    refreshKey?: number
    streamingWrite?: unknown
    streamingEdit?: unknown
    onNavigate?: (_path?: string) => void
    onNavigateToDir?: (_path?: string) => void
    onContextChange?: (_ctx: unknown) => void
  }
  let { initialPath }: Props = $props()
</script>

<div data-testid="wiki-stub">Wiki: {initialPath ?? 'root'}</div>
