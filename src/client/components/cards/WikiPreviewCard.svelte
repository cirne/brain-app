<script lang="ts">
  import StreamingAgentMarkdown from '../agent-conversation/StreamingAgentMarkdown.svelte'
  import { stripFrontMatter, takeFirstLines, WIKI_PREVIEW_MAX_LINES } from '@client/lib/markdown.js'

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

<div
  class="wiki-tool-preview"
  role="button"
  tabindex="0"
  aria-label="Open doc: {path}"
  onclick={onPreviewClick}
  onkeydown={onPreviewKeydown}
>
  <StreamingAgentMarkdown class="wiki-tool-preview-md" content={mdContent} />
</div>

<style>
  .wiki-tool-preview {
    margin: 4px 0 0;
    min-width: 0;
    max-width: 100%;
    text-align: left;
    cursor: pointer;
    border: none;
    background: transparent;
    padding: 0;
    font: inherit;
    color: inherit;
  }

  .wiki-tool-preview:focus {
    outline: none;
  }

  .wiki-tool-preview:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .wiki-tool-preview :global(.wiki-tool-preview-md) {
    display: block;
    max-height: 120px;
    overflow: hidden;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-2);
  }

  .wiki-tool-preview :global(.wiki-tool-preview-md a) {
    cursor: pointer;
  }
</style>
