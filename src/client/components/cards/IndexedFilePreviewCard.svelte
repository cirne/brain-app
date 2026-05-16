<script lang="ts">
  import { FileText } from '@lucide/svelte'
  import { t } from '@client/lib/i18n/index.js'
  import '../../styles/agent-conversation/toolWriteLink.css'

  let {
    title,
    sourceKind,
    excerpt,
    onOpen,
  }: {
    title: string
    sourceKind: string
    excerpt: string
    onOpen: () => void
  } = $props()
</script>

<div class="indexed-file-tool-preview mt-1 min-w-0 max-w-full">
  <button
    type="button"
    class="tool-write-link indexed-file-open group block w-full max-w-full text-left text-[11px] text-muted mb-1.5"
    onclick={onOpen}
    aria-label={$t('cards.indexedFilePreviewCard.ariaOpenFile', { title })}
  >
    <span class="indexed-file-title-row inline-flex max-w-full flex-wrap items-center gap-1.5">
      <FileText size={14} strokeWidth={2} aria-hidden="true" />
      <span
        class="indexed-file-title font-medium underline underline-offset-2 [overflow-wrap:anywhere] group-hover:text-accent"
      >{title}</span>
      {#if sourceKind}
        <span
          class="indexed-file-badge bg-[var(--chip-bg,rgba(0,0,0,0.06))] px-1.5 py-px font-mono text-[10px] text-muted"
        >{sourceKind}</span>
      {/if}
    </span>
  </button>
  <pre
    class="indexed-file-excerpt m-0 max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-border pt-2 text-[11px] leading-[1.4] [overflow-wrap:anywhere]"
  >{excerpt}</pre>
</div>
