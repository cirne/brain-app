<script lang="ts">
  import WikiFileName from '../WikiFileName.svelte'
  import { renderMarkdown, stripFrontMatter, takeFirstLines, WIKI_PREVIEW_MAX_LINES } from '../markdown.js'

  let {
    path,
    excerpt,
    onOpen,
  }: {
    path: string
    excerpt: string
    onOpen: () => void
  } = $props()

  const previewHtml = $derived.by(() => {
    const body = stripFrontMatter(excerpt)
    const limited = takeFirstLines(body, WIKI_PREVIEW_MAX_LINES)
    return renderMarkdown(limited)
  })
</script>

<div class="wiki-card">
  <button type="button" class="wiki-card-hit" aria-label="Open wiki page: {path}" onclick={onOpen}></button>
  <div class="wiki-card-path"><WikiFileName {path} /></div>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <div class="wiki-excerpt">{@html previewHtml}</div>
</div>

<style>
  .wiki-card {
    position: relative;
    margin: 8px 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-3);
  }
  .wiki-card-hit {
    position: absolute;
    inset: 0;
    z-index: 0;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: inherit;
    background: transparent;
    cursor: pointer;
  }
  .wiki-card-path {
    position: relative;
    z-index: 1;
    margin-bottom: 6px;
    pointer-events: none;
  }
  .wiki-excerpt {
    position: relative;
    z-index: 1;
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text);
    word-break: break-word;
    max-height: 120px;
    overflow: hidden;
    pointer-events: none;
  }
  .wiki-excerpt :global(h1) {
    font-size: 1.15em;
    font-weight: 600;
    margin: 0 0 0.35em;
    color: var(--text);
  }
  .wiki-excerpt :global(h2) {
    font-size: 1.05em;
    font-weight: 600;
    margin: 0.5em 0 0.25em;
  }
  .wiki-excerpt :global(h3) {
    font-size: 1em;
    font-weight: 600;
    margin: 0.45em 0 0.2em;
  }
  .wiki-excerpt :global(p) {
    margin: 0 0 0.45em;
    color: var(--text-2);
  }
  .wiki-excerpt :global(p:last-child) {
    margin-bottom: 0;
  }
  .wiki-excerpt :global(ul),
  .wiki-excerpt :global(ol) {
    margin: 0.25em 0 0.45em 1.1em;
    color: var(--text-2);
  }
  .wiki-excerpt :global(code) {
    background: var(--bg-2);
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.92em;
  }
  .wiki-excerpt :global(a) {
    position: relative;
    z-index: 2;
    pointer-events: auto;
    color: var(--accent);
  }
  .wiki-excerpt :global(.date-link),
  .wiki-excerpt :global(.wiki-link) {
    position: relative;
    z-index: 2;
    pointer-events: auto;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    background: none;
    border: none;
    padding: 0;
    display: inline;
  }
</style>
