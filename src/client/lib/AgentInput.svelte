<script lang="ts">
  import { ArrowUp } from 'lucide-svelte'
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

  const TEXTAREA_MIN_H = 34

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    const next = Math.max(TEXTAREA_MIN_H, Math.min(el.scrollHeight, 200))
    el.style.height = `${next}px`
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
    <div class="input-shell">
      <div class="input-shell-inner">
        <textarea
          class="chat-textarea"
          bind:this={inputEl}
          bind:value={input}
          oninput={handleInput}
          onkeydown={handleKeydown}
          {placeholder}
          rows="1"
          {disabled}
        ></textarea>
        {#if streaming}
          <button type="button" class="send-btn" onclick={() => onStop?.()} aria-label="Stop">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        {:else}
          <button
            type="button"
            class="send-btn"
            onclick={submit}
            disabled={disabled || !input.trim()}
            aria-label="Send message"
          >
            <ArrowUp size={14} strokeWidth={2.25} aria-hidden="true" />
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .input-area {
    position: relative;
    padding: 6px 12px;
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
    min-width: 0;
    width: 100%;
  }

  .input-shell {
    flex: 1;
    min-width: 0;
    min-height: 38px;
    padding: 3px 6px 3px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    overflow: hidden;
  }

  .input-shell:focus-within {
    border-color: var(--accent);
  }

  .input-shell-inner {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .chat-textarea {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    resize: none;
    border: none;
    border-radius: 0;
    padding: 8px 4px 5px 2px;
    font: inherit;
    font-size: 14px;
    line-height: 1.35;
    background: transparent;
    color: var(--text);
    min-height: 34px;
    max-height: 200px;
  }

  .chat-textarea:focus {
    outline: none;
  }

  .chat-textarea:disabled {
    opacity: 0.6;
  }

  .send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    flex-shrink: 0;
    cursor: pointer;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
