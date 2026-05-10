<script lang="ts">
  import { t } from '@client/lib/i18n/index.js'
  import '../../styles/agent-conversation/toolWriteLink.css'

  let {
    path,
    excerpt,
    onOpen,
  }: {
    path: string
    excerpt: string
    onOpen: () => void
  } = $props()
</script>

<div class="file-tool-preview mt-1 min-w-0 max-w-full">
  <button
    type="button"
    class="tool-write-link file-tool-open group block w-full max-w-full break-words text-[11px] text-muted mb-1.5 [overflow-wrap:anywhere]"
    onclick={onOpen}
    aria-label={$t('cards.filePreviewCard.ariaOpenFile', { path })}
  >
    <span class="file-tool-path font-mono underline underline-offset-2 group-hover:text-accent">{path}</span>
  </button>
  <pre
    class="file-tool-excerpt m-0 max-h-32 overflow-auto whitespace-pre-wrap break-words border-t border-border bg-transparent pt-2 font-mono text-[11px] leading-[1.4] text-muted [overflow-wrap:anywhere]"
  >{excerpt}</pre>
</div>
