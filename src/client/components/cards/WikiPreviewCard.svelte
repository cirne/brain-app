<script lang="ts">
  import StreamingAgentMarkdown from '../agent-conversation/StreamingAgentMarkdown.svelte'
  import WikiFileName from '../WikiFileName.svelte'
  import { stripFrontMatter, takeFirstLines, WIKI_PREVIEW_MAX_LINES } from '@client/lib/markdown.js'
  import '../../styles/agent-conversation/toolWriteLink.css'

  let {
    path,
    excerpt,
    onOpen,
    onNavigateWiki,
  }: {
    path: string
    excerpt: string
    onOpen: () => void
    onNavigateWiki?: (_path: string) => void
  } = $props()

  const mdContent = $derived.by(() => {
    const body = stripFrontMatter(excerpt)
    return takeFirstLines(body, WIKI_PREVIEW_MAX_LINES)
  })

  function onPreviewClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a[data-wiki]')
    if (a) {
      e.preventDefault()
      e.stopPropagation()
      const p = a.getAttribute('data-wiki')
      if (p) onNavigateWiki?.(p)
      return
    }
    onOpen()
  }

  function onPreviewKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if ((e.target as HTMLElement).closest('a[data-wiki]')) return
    if ((e.target as HTMLElement).tagName === 'A') return
    e.preventDefault()
    onOpen()
  }
</script>

<div class="wiki-tool-preview-card">
  <button type="button" class="tool-write-link wiki-preview-file-link" onclick={() => onOpen()} aria-label="Open doc: {path}">
    <WikiFileName {path} />
  </button>
  <div
    class="wiki-tool-preview-body"
    role="button"
    tabindex="0"
    aria-label="Open wiki preview for {path}"
    onclick={onPreviewClick}
    onkeydown={onPreviewKeydown}
  >
    <StreamingAgentMarkdown class="wiki-tool-preview-md" content={mdContent} />
  </div>
</div>

<style>
  .wiki-tool-preview-card {
    margin: 4px 0 0;
    min-width: 0;
    max-width: 100%;
  }

  .wiki-preview-file-link {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.35em;
    margin-bottom: 6px;
    font-size: 11px;
    color: var(--text-2);
    text-align: left;
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  .wiki-tool-preview-body {
    margin: 0;
    padding: 8px 0 0;
    border-top: 1px solid var(--border);
    cursor: pointer;
    text-align: left;
    outline: none;
    min-width: 0;
  }

  .wiki-tool-preview-body:focus-visible {
    border-radius: 2px;
    box-shadow:
      inset 2px 0 0 var(--accent),
      inset -2px 0 0 var(--accent);
  }

  .wiki-tool-preview-body :global(.wiki-tool-preview-md) {
    display: block;
    max-height: 120px;
    overflow: hidden;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-2);
  }

  .wiki-tool-preview-body :global(.wiki-tool-preview-md a) {
    cursor: pointer;
  }
</style>
