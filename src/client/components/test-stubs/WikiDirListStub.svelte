<script lang="ts">
  type Props = {
    dirPath?: string
    refreshKey?: number
    onOpenFile?: (_path: string) => void
    onOpenDir?: (_path: string) => void
    onContextChange?: (_ctx: unknown) => void
  }
  let { dirPath }: Props = $props()
</script>

<div data-testid="wiki-dir-stub">WikiDir: {dirPath ?? 'root'}</div>
