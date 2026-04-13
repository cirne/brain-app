<script lang="ts">
  import WikiFileName from './WikiFileName.svelte'

  let {
    placeholder = 'Ask anything...',
    disabled = false,
    streaming = false,
    wikiFiles = [],
    onSend,
    onStop,
  }: {
    placeholder?: string
    disabled?: boolean
    streaming?: boolean
    wikiFiles?: string[]
    onSend: (_text: string) => void
    onStop?: () => void
  } = $props()

  let input = $state('')
  let inputEl: HTMLTextAreaElement
  let showMentions = $state(false)
  let mentionFilter = $state('')
  let mentionStart = $state(-1)
  let selectedMention = $state(0)

  function filteredMentions(): string[] {
    if (!mentionFilter) return wikiFiles.slice(0, 10)
    const q = mentionFilter.toLowerCase()
    return wikiFiles.filter(f => f.toLowerCase().includes(q)).slice(0, 10)
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement
    input = target.value
    autoResize(target)

    const pos = target.selectionStart
    const before = input.slice(0, pos)
    const atIndex = before.lastIndexOf('@')

    if (atIndex >= 0 && (atIndex === 0 || before[atIndex - 1] === ' ' || before[atIndex - 1] === '\n')) {
      const query = before.slice(atIndex + 1)
      if (!query.includes(' ') && !query.includes('\n')) {
        mentionStart = atIndex
        mentionFilter = query
        showMentions = true
        selectedMention = 0
        return
      }
    }
    showMentions = false
  }

  function insertMention(path: string) {
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + mentionFilter.length + 1)
    input = `${before}@${path} ${after}`
    showMentions = false
    inputEl?.focus()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (showMentions) {
      const items = filteredMentions()
      if (e.key === 'ArrowDown') { e.preventDefault(); selectedMention = Math.min(selectedMention + 1, items.length - 1); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); selectedMention = Math.max(selectedMention - 1, 0); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (items[selectedMention]) insertMention(items[selectedMention]); return }
      if (e.key === 'Escape') { showMentions = false; return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  export function focus() {
    inputEl?.focus()
  }

  function submit() {
    const text = input.trim()
    if (!text || disabled) return
    input = ''
    if (inputEl) inputEl.style.height = 'auto'
    onSend(text)
  }
</script>

<div class="input-area">
  {#if showMentions}
    <div class="mention-dropdown">
      {#each filteredMentions() as file, i}
        <button
          class="mention-item"
          class:selected={i === selectedMention}
          onmousedown={(e) => { e.preventDefault(); insertMention(file) }}
        >
          <WikiFileName path={file} />
        </button>
      {:else}
        <div class="mention-empty">No matching files</div>
      {/each}
    </div>
  {/if}

  <div class="input-row">
    <textarea
      bind:this={inputEl}
      bind:value={input}
      oninput={handleInput}
      onkeydown={handleKeydown}
      {placeholder}
      rows="1"
      {disabled}
    ></textarea>
    {#if streaming}
      <button class="send-btn" onclick={() => onStop?.()}>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
      </button>
    {:else}
      <button class="send-btn" onclick={submit} disabled={disabled || !input.trim()}>Send</button>
    {/if}
  </div>
</div>

<style>
  .input-area {
    position: relative;
    padding: 10px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }

  .mention-dropdown {
    position: absolute;
    bottom: 100%;
    left: 12px;
    right: 12px;
    max-height: 200px;
    overflow-y: auto;
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 4px;
    box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
  }

  .mention-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    font-size: 13px;
    color: var(--text);
  }
  .mention-item:hover, .mention-item.selected { background: var(--accent-dim); color: var(--accent); }
  .mention-empty { padding: 8px 12px; font-size: 12px; color: var(--text-2); }

  .input-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
  }

  .input-row textarea {
    flex: 1;
    resize: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 12px;
    font: inherit;
    font-size: 14px;
    background: var(--bg);
    color: var(--text);
    line-height: 1.4;
    min-height: 38px;
    max-height: 200px;
  }
  .input-row textarea:focus { outline: none; border-color: var(--accent); }
  .input-row textarea:disabled { opacity: 0.6; }

  .send-btn {
    height: 38px;
    padding: 0 14px;
    border-radius: 8px;
    background: var(--accent);
    color: white;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
