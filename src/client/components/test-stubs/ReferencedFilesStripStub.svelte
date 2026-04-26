<script lang="ts">
  let {
    paths,
    onOpenWiki: _onOpenWiki,
  }: {
    paths: string[]
    onOpenWiki?: (_path: string) => void
  } = $props()
</script>

<div data-testid="referenced-files-strip" data-paths={paths.join(',')}>
  {#each paths as path}
    <span data-path={path}>{path}</span>
  {/each}
</div>
