<script lang="ts">
  import StreamingAgentMarkdown from '@components/agent-conversation/StreamingAgentMarkdown.svelte'
  import WikiFileName from '@components/WikiFileName.svelte'
  import { stripFrontMatter, takeFirstLines, WIKI_PREVIEW_MAX_LINES } from '@client/lib/markdown.js'
  import { t } from '@client/lib/i18n/index.js'
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

<div class="wiki-tool-preview-card mt-1 min-w-0 max-w-full">
  <button
    type="button"
    class="tool-write-link wiki-preview-file-link mb-1.5 flex w-full min-w-0 max-w-full flex-wrap items-baseline gap-[0.35em] text-left text-[11px] text-muted"
    onclick={() => onOpen()}
    aria-label={$t('cards.wikiPreviewCard.ariaOpenDoc', { path })}
  >
    <WikiFileName {path} />
  </button>
  <div
    class="wiki-tool-preview-body m-0 min-w-0 cursor-pointer border-t border-border pt-2 text-left outline-none focus-visible:[box-shadow:inset_2px_0_0_var(--accent),inset_-2px_0_0_var(--accent)] [&_.wiki-tool-preview-md]:block [&_.wiki-tool-preview-md]:max-h-[120px] [&_.wiki-tool-preview-md]:overflow-hidden [&_.wiki-tool-preview-md]:text-[13px] [&_.wiki-tool-preview-md]:leading-[1.45] [&_.wiki-tool-preview-md]:text-muted [&_.wiki-tool-preview-md_a]:cursor-pointer"
    role="button"
    tabindex="0"
    aria-label={$t('cards.wikiPreviewCard.ariaOpenWikiPreview', { path })}
    onclick={onPreviewClick}
    onkeydown={onPreviewKeydown}
  >
    <StreamingAgentMarkdown class="wiki-tool-preview-md" content={mdContent} />
  </div>
</div>
