<script lang="ts">
  import { onMount } from 'svelte'
  import type { Component } from 'svelte'
  import { Mail, FileText, Table2, File, X, Search } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
  import { formatDate } from '@client/lib/formatDate.js'
  import WikiFileName from '@components/WikiFileName.svelte'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'

  type WikiResult = { type: 'wiki'; path: string; score: number; excerpt: string }
  type EmailResult = {
    type: 'email'
    id: string
    from: string
    subject: string
    date: string
    snippet: string
    score: number
  }
  type IndexedFileResult = {
    type: 'indexed-file'
    id: string
    sourceId: string
    sourceKind: string
    subject: string
    date: string
    snippet: string
    score: number
    mime?: string
  }
  type SearchResult = WikiResult | EmailResult | IndexedFileResult

  let {
    onOpenWiki,
    onOpenEmail,
    onOpenIndexedFile,
    onClose,
  }: {
    onOpenWiki: (_path: string) => void
    onOpenEmail: (_id: string, _subject: string, _from: string) => void
    onOpenIndexedFile: (_id: string, _opts?: { sourceId?: string; title?: string }) => void
    onClose: () => void
  } = $props()

  let query = $state('')
  let results = $state<SearchResult[]>([])
  let loading = $state(false)
  let highlightIndex = $state(-1)
  let inputEl: HTMLInputElement
  let resultsEl: HTMLDivElement | undefined = $state()

  let debounceTimer: ReturnType<typeof setTimeout>

  const searchLatest = createAsyncLatest({ abortPrevious: true })

  /** Prefer Meta (⌘) on Apple platforms; Ctrl elsewhere (matches globalShortcuts). */
  const searchShortcutHintText = $derived.by(() => {
    const plat = typeof navigator !== 'undefined' ? (navigator.platform ?? '') : ''
    const ua = typeof navigator !== 'undefined' ? (navigator.userAgent ?? '') : ''
    const apple = /Mac|iPhone|iPad|iPod/i.test(plat) || /Mac OS/i.test(ua)
    return apple ? $t('search.overlay.shortcut.mac') : $t('search.overlay.shortcut.other')
  })

  $effect(() => {
    void results
    highlightIndex = -1
  })

  $effect(() => {
    const idx = highlightIndex
    if (idx < 0 || !resultsEl) return
    queueMicrotask(() => {
      const el = resultsEl?.querySelector(`button[data-result-index="${idx}"]`)
      if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
        ;(el as HTMLElement).scrollIntoView({ block: 'nearest' })
      }
    })
  })

  function pickIndexedLeadIcon(mime?: string): Component {
    const m = (mime ?? '').toLowerCase()
    if (
      m.includes('spreadsheet') ||
      m.includes('excel') ||
      m.includes('csv') ||
      m.includes('tab-separated-values')
    ) {
      return Table2
    }
    if (m.includes('presentation') || m.includes('powerpoint')) {
      return FileText
    }
    if (
      m.includes('pdf') ||
      m.includes('wordprocessing') ||
      m.includes('/document') ||
      m.includes('text/')
    ) {
      return FileText
    }
    return File
  }

  function indexedResultMeta(r: IndexedFileResult): string {
    if (r.sourceKind === 'googleDrive') return `Google Drive · ${formatDate(r.date)}`
    if (r.sourceKind === 'localDir') return `Files · ${formatDate(r.date)}`
    return `${r.sourceKind} · ${formatDate(r.date)}`
  }

  function openResultAt(index: number) {
    const result = results[index]
    if (!result) return
    if (result.type === 'wiki') {
      onOpenWiki(result.path)
    } else if (result.type === 'indexed-file') {
      onOpenIndexedFile(result.id, { sourceId: result.sourceId, title: result.subject })
    } else {
      onOpenEmail(result.id, result.subject, result.from)
    }
    onClose()
  }

  function handleSearchInputKeydown(e: KeyboardEvent) {
    const len = results.length
    if (!len || loading) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (highlightIndex < len - 1) highlightIndex = highlightIndex + 1
      return
    }
    if (e.key === 'ArrowUp') {
      if (highlightIndex > 0) {
        e.preventDefault()
        highlightIndex -= 1
      } else if (highlightIndex === 0) {
        e.preventDefault()
        highlightIndex = -1
      }
      return
    }
    if (e.key === 'Enter' && highlightIndex >= 0 && highlightIndex < len) {
      e.preventDefault()
      openResultAt(highlightIndex)
    }
  }

  onMount(() => {
    inputEl?.focus()

    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  })

  $effect(() => {
    const q = query
    clearTimeout(debounceTimer)
    if (!q.trim()) {
      searchLatest.begin()
      results = []
      loading = false
      return
    }
    loading = true
    debounceTimer = setTimeout(async () => {
      const { token, signal } = searchLatest.begin()
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal })
        if (searchLatest.isStale(token)) return
        const data = await res.json()
        if (searchLatest.isStale(token)) return
        results = data.results ?? []
      } catch (e) {
        if (!searchLatest.isStale(token) && !isAbortError(e)) {
          /* ignore */
        }
      } finally {
        if (!searchLatest.isStale(token)) loading = false
      }
    }, 250)
  })

</script>

<div
  class="overlay-root fixed inset-0 z-[500] flex flex-col overflow-hidden md:items-center md:justify-start md:pt-20"
>
  <button
    type="button"
    class="search-backdrop absolute inset-0 z-0 m-0 block appearance-none border-none bg-surface p-0 [cursor:default] md:bg-black/50"
    aria-label={$t('search.overlay.close')}
    onclick={onClose}
  ></button>
  <div
    class="search-panel relative z-[1] flex min-h-0 flex-1 flex-col self-stretch overflow-hidden md:max-h-[calc(100vh-80px)] md:w-[560px] md:flex-[0_1_auto] md:self-center"
    role="dialog"
    aria-modal="true"
    aria-label={$t('search.overlay.title')}
    tabindex="-1"
  >
    <div
      class="header flex shrink-0 items-center gap-2 border-b border-border bg-surface-2 px-3 py-2.5"
    >
      <Search size={16} class="search-icon" />
      <div class="relative min-w-0 flex-1">
        <input
          bind:this={inputEl}
          bind:value={query}
          class={cn(
            'input w-full min-w-0 border-none bg-transparent py-1 text-base text-foreground focus:outline-none [&::-webkit-search-cancel-button]:hidden',
            !query.trim() && 'pr-14',
          )}
          placeholder={$t('search.placeholder.global')}
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          type="search"
          onkeydown={handleSearchInputKeydown}
        />
        {#if !query.trim()}
          <span
            class="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 select-none text-xs tabular-nums text-muted opacity-70"
            aria-hidden="true"
          >{searchShortcutHintText}</span>
        {/if}
      </div>
      {#if loading}
        <span
          class="spinner h-4 w-4 shrink-0 rounded-full animate-[spin_0.6s_linear_infinite] border-2 border-border [border-top-color:var(--accent)]"
          aria-hidden="true"
        ></span>
      {:else if query}
        <button
          class="clear-btn flex shrink-0 items-center p-1 text-muted hover:text-foreground"
          onclick={() => { query = ''; inputEl?.focus() }}
          aria-label={$t('search.overlay.clear')}
        >
          <X size={16} />
        </button>
      {/if}
      <button
        class="close-btn shrink-0 whitespace-nowrap py-1 pl-2 pr-0 text-sm text-accent"
        onclick={onClose}
      >{$t('search.overlay.cancel')}</button>
    </div>

    <div
      class="results flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch] md:max-h-[480px] md:border md:border-t-0 md:border-border md:bg-surface md:[box-shadow:0_8px_32px_rgba(0,0,0,0.4)]"
      bind:this={resultsEl}
    >
    {#if query.trim()}
      {#if !loading && results.length === 0}
      <p class="hint px-5 py-10 text-center text-sm text-muted">{$t('search.overlay.noResults', { query })}</p>
      {:else}
      {#each results as result, i (`${result.type}:${result.type === 'wiki' ? result.path : result.id}`)}
        {#if result.type === 'wiki'}
          <button
            type="button"
            class={cn(
              'result block min-h-[52px] w-full border-b border-border px-4 py-3 text-left active:bg-surface-3',
              highlightIndex === i && 'result-highlight bg-surface-3',
            )}
            data-result-index={i}
            onclick={() => { onOpenWiki(result.path); onClose() }}
          >
            <span class="result-body flex min-w-0 flex-1 flex-col gap-[2px]">
              <span
                class="result-title wiki-result-title block min-w-0 overflow-hidden whitespace-nowrap text-ellipsis text-sm text-foreground [&_.wfn-title-row]:max-w-full"
              >
                <WikiFileName path={result.path} />
              </span>
              {#if result.excerpt}
                <span
                  class="result-snippet wiki-result-excerpt mt-0 overflow-hidden text-xs leading-snug text-muted [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                >{result.excerpt}</span>
              {/if}
            </span>
          </button>
        {:else if result.type === 'email'}
          <button
            type="button"
            class={cn(
              'result block min-h-[52px] w-full border-b border-border px-4 py-3 text-left active:bg-surface-3',
              highlightIndex === i && 'result-highlight bg-surface-3',
            )}
            data-result-index={i}
            onclick={() => { onOpenEmail(result.id, result.subject, result.from); onClose() }}
          >
            <span class="result-body flex min-w-0 flex-1 flex-col gap-[2px]">
              <span class="email-result-title wfn-title-row w-full max-w-full">
                <span class="wfn-lead-icon" aria-hidden="true">
                  <Mail size={12} />
                </span>
                <span
                  class="email-subject min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis text-sm text-foreground"
                >{result.subject}</span>
              </span>
              <span
                class="result-meta overflow-hidden whitespace-nowrap text-ellipsis text-xs text-muted"
              >{result.from} · {formatDate(result.date)}</span>
              {#if result.snippet}
                <span
                  class="result-snippet mt-0.5 overflow-hidden text-xs leading-snug text-muted [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                >{result.snippet}</span>
              {/if}
            </span>
          </button>
        {:else}
          {@const LeadIcon = pickIndexedLeadIcon(result.mime)}
          <button
            type="button"
            class={cn(
              'result block min-h-[52px] w-full border-b border-border px-4 py-3 text-left active:bg-surface-3',
              highlightIndex === i && 'result-highlight bg-surface-3',
            )}
            data-result-index={i}
            onclick={() => {
              onOpenIndexedFile(result.id, { sourceId: result.sourceId, title: result.subject })
              onClose()
            }}
          >
            <span class="result-body flex min-w-0 flex-1 flex-col gap-[2px]">
              <span class="email-result-title wfn-title-row w-full max-w-full">
                <span class="wfn-lead-icon" aria-hidden="true">
                  <LeadIcon size={12} />
                </span>
                <span
                  class="email-subject min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis text-sm text-foreground"
                >{result.subject}</span>
              </span>
              <span class="result-meta overflow-hidden whitespace-nowrap text-ellipsis text-xs text-muted"
              >{indexedResultMeta(result)}</span>
              {#if result.snippet}
                <span
                  class="result-snippet mt-0.5 overflow-hidden text-xs leading-snug text-muted [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                >{result.snippet}</span>
              {/if}
            </span>
          </button>
        {/if}
      {/each}
      {/if}
    {/if}
    </div>
  </div>
</div>

<style>
  @import '../styles/search/wfnLeadIcon.css';

  /* `class` prop on lucide icon components is not Tailwind-mergeable; keep as :global. */
  :global(.search-icon) {
    color: var(--text-2);
    flex-shrink: 0;
  }
</style>
