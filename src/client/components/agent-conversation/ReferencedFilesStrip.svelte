<script lang="ts">
  import WikiFileName from '@components/WikiFileName.svelte'

  let {
    paths,
    onOpenWiki,
  }: {
    paths: string[]
    onOpenWiki?: (_path: string) => void
  } = $props()
</script>

<div class="mt-4 border-t border-border pt-3">
  <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">Referenced</div>
  <div class="flex flex-wrap gap-1.5">
    {#each paths as path}
      <button
        class="inline-flex items-center border border-border bg-surface-3 px-2.5 py-1 text-xs transition-[border-color,background] duration-150 [font:inherit] hover:border-accent hover:bg-accent-dim hover:[&_.wfn-name]:text-accent hover:[&_.wfn-folder]:text-accent hover:[&_.wfn-folder]:opacity-70"
        onclick={() => onOpenWiki?.(path)}
      >
        <WikiFileName {path} />
      </button>
    {/each}
  </div>
</div>
