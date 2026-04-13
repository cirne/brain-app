<script lang="ts">
  import { onMount } from 'svelte'
  import { FileText, Mail, X, Search } from 'lucide-svelte'
  import { formatDate } from './formatDate.js'

  type WikiResult = { type: 'wiki'; path: string; score: number }
  type EmailResult = { type: 'email'; id: string; from: string; subject: string; date: string; snippet: string; score: number }
  type SearchResult = WikiResult | EmailResult

  let {
    onOpenWiki,
    onOpenEmail,
    onClose,
  }: {
    onOpenWiki: (_path: string) => void
    onOpenEmail: (_id: string, _subject: string, _from: string) => void
    onClose: () => void
  } = $props()

  let query = $state('')
  let results = $state<SearchResult[]>([])
  let loading = $state(false)
  let inputEl: HTMLInputElement

  let debounceTimer: ReturnType<typeof setTimeout>

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
      results = []
      loading = false
      return
    }
    loading = true
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        results = data.results ?? []
      } catch { /* ignore */ }
      loading = false
    }, 250)
  })

  function wikiTitle(path: string) {
    const name = path.replace(/\.md$/, '').split('/').pop() ?? path
    return name.replace(/[-_]/g, ' ')
  }

  function wikiContext(path: string) {
    const parts = path.replace(/\.md$/, '').split('/')
    return parts.length > 1 ? parts.slice(0, -1).join(' / ') : ''
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Search">
  <div class="header">
    <Search size={16} class="search-icon" />
    <input
      bind:this={inputEl}
      bind:value={query}
      class="input"
      placeholder="Search docs and emails..."
      autocomplete="off"
      autocorrect="off"
      spellcheck="false"
      type="search"
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

  <div class="results">
    {#if !query.trim()}
      <p class="hint">Search wiki docs and emails</p>
    {:else if !loading && results.length === 0}
      <p class="hint">No results for "{query}"</p>
    {:else}
      {#each results as result (result.type === 'wiki' ? result.path : result.id)}
        {#if result.type === 'wiki'}
          <button
            class="result"
            onclick={() => { onOpenWiki(result.path); onClose() }}
          >
            <span class="result-type"><FileText size={11} /></span>
            <span class="result-body">
              <span class="result-title">{wikiTitle(result.path)}</span>
              {#if wikiContext(result.path)}
                <span class="result-meta">{wikiContext(result.path)}</span>
              {/if}
            </span>
          </button>
        {:else}
          <button
            class="result"
            onclick={() => { onOpenEmail(result.id, result.subject, result.from); onClose() }}
          >
            <span class="result-type"><Mail size={11} /></span>
            <span class="result-body">
              <span class="result-title">{result.subject}</span>
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

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
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
    border-radius: 50%;
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

  .hint {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-2);
    font-size: 14px;
  }

  .result {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 12px 16px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    min-height: 52px;
  }
  .result:active { background: var(--bg-3); }

  .result-type {
    color: var(--text-2);
    flex-shrink: 0;
    padding-top: 2px;
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
    .overlay {
      background: rgba(0, 0, 0, 0.5);
      align-items: center;
      justify-content: flex-start;
      padding-top: 80px;
    }

    .header {
      width: 560px;
      border-radius: 10px 10px 0 0;
    }

    .results {
      width: 560px;
      max-height: 480px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 10px 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
  }
</style>
