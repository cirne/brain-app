<script lang="ts">
  import { onMount } from 'svelte'
  import { BookOpen, Mail, X, Search } from 'lucide-svelte'
  import { formatDate } from '@client/lib/formatDate.js'
  import WikiFileName from './WikiFileName.svelte'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'

  type WikiResult = { type: 'wiki'; path: string; score: number; excerpt: string }
  type EmailResult = { type: 'email'; id: string; from: string; subject: string; date: string; snippet: string; score: number }
  type SearchResult = WikiResult | EmailResult

  let {
    onOpenWiki,
    onOpenEmail,
    onClose,
    onWikiHome,
  }: {
    onOpenWiki: (_path: string) => void
    onOpenEmail: (_id: string, _subject: string, _from: string) => void
    onClose: () => void
    onWikiHome?: () => void
  } = $props()

  let query = $state('')
  let results = $state<SearchResult[]>([])
  let loading = $state(false)
  let highlightIndex = $state(-1)
  let inputEl: HTMLInputElement
  let resultsEl: HTMLDivElement | undefined

  let debounceTimer: ReturnType<typeof setTimeout>

  const searchLatest = createAsyncLatest({ abortPrevious: true })

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

  function openResultAt(index: number) {
    const result = results[index]
    if (!result) return
    if (result.type === 'wiki') {
      onOpenWiki(result.path)
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

<div class="overlay-root">
  <button type="button" class="search-backdrop" aria-label="Close search" onclick={onClose}></button>
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search" tabindex="-1">
    <div class="header">
    <Search size={16} class="search-icon" />
    <input
      bind:this={inputEl}
      bind:value={query}
      class="input"
      placeholder="Search your docs and emails..."
      autocomplete="off"
      autocorrect="off"
      spellcheck="false"
      type="search"
      onkeydown={handleSearchInputKeydown}
    />
    {#if loading}
      <span class="spinner" aria-hidden="true"></span>
    {:else if query}
      <button class="clear-btn" onclick={() => { query = ''; inputEl?.focus() }} aria-label="Clear">
        <X size={16} />
      </button>
    {/if}
    <button class="close-btn" onclick={onClose}>Cancel</button>
    </div>

    <div class="results" bind:this={resultsEl}>
    {#if !query.trim()}
      <div class="search-empty">
        <p class="hint">Search your docs and emails</p>
        {#if onWikiHome}
          <button type="button" class="wiki-home-cmd" onclick={() => { onWikiHome(); onClose() }}>
            <BookOpen size={16} strokeWidth={2} aria-hidden="true" />
            <span>Wiki home</span>
          </button>
        {/if}
      </div>
    {:else if !loading && results.length === 0}
      <p class="hint">No results for "{query}"</p>
    {:else}
      {#each results as result, i (result.type === 'wiki' ? result.path : result.id)}
        {#if result.type === 'wiki'}
          <button
            type="button"
            class="result"
            class:result-highlight={highlightIndex === i}
            data-result-index={i}
            onclick={() => { onOpenWiki(result.path); onClose() }}
          >
            <span class="result-body">
              <span class="result-title wiki-result-title">
                <WikiFileName path={result.path} />
              </span>
              {#if result.excerpt}
                <span class="result-snippet wiki-result-excerpt">{result.excerpt}</span>
              {/if}
            </span>
          </button>
        {:else}
          <button
            type="button"
            class="result"
            class:result-highlight={highlightIndex === i}
            data-result-index={i}
            onclick={() => { onOpenEmail(result.id, result.subject, result.from); onClose() }}
          >
            <span class="result-body">
              <span class="email-result-title wfn-title-row">
                <span class="wfn-lead-icon" aria-hidden="true">
                  <Mail size={12} />
                </span>
                <span class="email-subject">{result.subject}</span>
              </span>
              <span class="result-meta">{result.from} · {formatDate(result.date)}</span>
              {#if result.snippet}
                <span class="result-snippet">{result.snippet}</span>
              {/if}
            </span>
          </button>
        {/if}
      {/each}
    {/if}
    </div>
  </div>
</div>

<style>
  @import '../styles/search/wfnLeadIcon.css';

  .overlay-root {
    position: fixed;
    inset: 0;
    z-index: 500;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .search-backdrop {
    position: absolute;
    inset: 0;
    z-index: 0;
    margin: 0;
    padding: 0;
    border: none;
    background: var(--bg);
    cursor: default;
    display: block;
    appearance: none;
  }

  .search-panel {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    align-self: stretch;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  :global(.search-icon) {
    color: var(--text-2);
    flex-shrink: 0;
  }

  .input {
    flex: 1;
    font-size: 16px;
    background: transparent;
    border: none;
    color: var(--text);
    min-width: 0;
    padding: 4px 0;
  }
  .input:focus { outline: none; }
  .input::-webkit-search-cancel-button { display: none; }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  .clear-btn {
    color: var(--text-2);
    display: flex;
    align-items: center;
    padding: 4px;
    flex-shrink: 0;
  }
  .clear-btn:hover { color: var(--text); }

  .close-btn {
    font-size: 14px;
    color: var(--accent);
    padding: 4px 0 4px 8px;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .results {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .search-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px 20px 40px;
  }

  .search-empty .hint {
    padding: 0;
    text-align: center;
    color: var(--text-2);
    font-size: 14px;
  }

  .wiki-home-cmd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 14px;
border: 1px solid var(--border);
    background: var(--bg-3);
    color: var(--text);
    font-size: 14px;
  }

  .wiki-home-cmd:hover {
    background: var(--bg-2);
  }

  .hint {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-2);
    font-size: 14px;
  }

  .result {
    display: block;
    width: 100%;
    padding: 12px 16px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    min-height: 52px;
  }
  .result:active { background: var(--bg-3); }

  .result.result-highlight {
    background: var(--bg-3);
  }

  .result-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .result-title {
    font-size: 14px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wiki-result-title {
    display: block;
    min-width: 0;
  }

  .wiki-result-title :global(.wfn-title-row) {
    max-width: 100%;
  }

  .email-result-title {
    width: 100%;
    max-width: 100%;
  }

  .email-subject {
    font-size: 14px;
    color: var(--text);
    min-width: 0;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wiki-result-excerpt {
    margin-top: 0;
  }

  .result-meta {
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-snippet {
    font-size: 12px;
    color: var(--text-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
    margin-top: 2px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (min-width: 768px) {
    .overlay-root {
      align-items: center;
      justify-content: flex-start;
      padding-top: 80px;
    }

    .search-backdrop {
      background: rgba(0, 0, 0, 0.5);
    }

    .search-panel {
      align-self: center;
      width: 560px;
      flex: 0 1 auto;
      max-height: calc(100vh - 80px);
    }

    .header {
}

    .results {
      max-height: 480px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-top: none;
box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
  }
</style>
