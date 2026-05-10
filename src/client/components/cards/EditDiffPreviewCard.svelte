<script lang="ts">
  import WikiFileName from '@components/WikiFileName.svelte'
  import { unifiedDiffChangedLinesOnly } from '@client/lib/cards/editDiffDisplay.js'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
  import '../../styles/agent-conversation/toolWriteLink.css'

  let {
    path,
    unified,
    onOpen,
  }: {
    path: string
    unified: string
    onOpen: () => void
  } = $props()

  const changedLines = $derived(unifiedDiffChangedLinesOnly(unified))
</script>

<div class="edit-diff-preview mt-1 min-w-0 max-w-full">
  <button
    type="button"
    class="tool-write-link edit-diff-open mb-1.5 flex w-full min-w-0 max-w-full flex-wrap items-baseline gap-[0.35em] text-left text-[11px] text-muted"
    onclick={onOpen}
    aria-label={$t('cards.editDiffPreviewCard.ariaOpenWiki', { path })}
  >
    <WikiFileName {path} />
  </button>
  <div
    class="edit-diff-lines m-0 max-h-[220px] overflow-auto border-t border-border pt-2 font-mono text-[11px] leading-[1.45] text-muted"
  >
    {#each changedLines as line, li (`${li}:${line}`)}
      <div
        class={cn(
          'edit-diff-line whitespace-pre-wrap break-words border-l-2 border-transparent pl-1',
          line.startsWith('+') && 'edit-diff-add border-l-success text-foreground',
          line.startsWith('-') && 'edit-diff-remove border-l-danger text-foreground',
        )}
      >{line}</div>
    {/each}
  </div>
</div>
