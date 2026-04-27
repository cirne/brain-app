<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { ArrowUp, List, MessageSquarePlus, Square } from 'lucide-svelte'
  import WikiFileName from './WikiFileName.svelte'
  import type { SkillMenuItem } from '@client/lib/agentUtils.js'
  import { handleTextareaCursorKeys } from '@client/lib/agentInputCursor.js'

  let {
    placeholder = 'What do you need to know or get done?',
    disabled = false,
    streaming = false,
    /** OPP-016: FIFO texts queued until the current stream ends (shown stacked, oldest first). */
    queuedMessages = [] as string[],
    wikiFiles = [],
    skills = [] as SkillMenuItem[],
    onSend,
    onStop,
    onDraftChange,
    /** Mobile doc slide-over dock: no gray bar behind the field; only the bordered input shows. */
    transparentSurround = false,
    /**
     * When set, a “new chat” control is integrated on the left inside the bordered field (like send on the right).
     */
    onNewChat = undefined as (() => void) | undefined,
  }: {
    placeholder?: string
    disabled?: boolean
    streaming?: boolean
    queuedMessages?: string[]
    wikiFiles?: string[]
    skills?: SkillMenuItem[]
    onSend: (_text: string) => void
    onStop?: () => void
    /** Fires whenever the draft string changes (typing, send clear, @mention, /skill, append). */
    onDraftChange?: (_draft: string) => void
    transparentSurround?: boolean
    onNewChat?: () => void
  } = $props()

  let input = $state('')
  let inputEl: HTMLTextAreaElement
  let showMentions = $state(false)
  let mentionFilter = $state('')
  let mentionStart = $state(-1)
  let selectedMention = $state(0)

  let showSlash = $state(false)
  let slashFilter = $state('')
  let selectedSlash = $state(0)

  function filteredMentions(): string[] {
    if (!mentionFilter) return wikiFiles.slice(0, 10)
    const q = mentionFilter.toLowerCase()
    return wikiFiles.filter(f => f.toLowerCase().includes(q)).slice(0, 10)
  }

  function filteredSkills(): SkillMenuItem[] {
    if (!slashFilter) return skills.slice(0, 10)
    const q = slashFilter.toLowerCase()
    const matches = skills.filter(
      s =>
        s.slug.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q),
    )
    matches.sort((a, b) => {
      const aPrefix = a.slug.toLowerCase().startsWith(q) ? 0 : 1
      const bPrefix = b.slug.toLowerCase().startsWith(q) ? 0 : 1
      return aPrefix - bPrefix || a.slug.localeCompare(b.slug)
    })
    return matches.slice(0, 10)
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
        showSlash = false
        selectedMention = 0
        return
      }
    }
    showMentions = false

    const lineStart = before.lastIndexOf('\n') + 1
    const line = before.slice(lineStart)
    if (line.startsWith('/')) {
      const firstSpace = line.indexOf(' ', 1)
      const relCursor = pos - lineStart
      if (firstSpace === -1 || relCursor <= firstSpace) {
        slashFilter = firstSpace === -1 ? line.slice(1) : line.slice(1, firstSpace)
        showSlash = true
        selectedSlash = 0
        return
      }
    }
    showSlash = false
  }

  function insertMention(path: string) {
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + mentionFilter.length + 1)
    input = `${before}@${path} ${after}`
    showMentions = false
    inputEl?.focus()
  }

  function insertSlash(slug: string) {
    const pos = inputEl?.selectionStart ?? input.length
    const before = input.slice(0, pos)
    const lineStart = before.lastIndexOf('\n') + 1
    const prefix = input.slice(0, lineStart)
    const after = input.slice(pos)
    input = `${prefix}/${slug} ${after}`
    showSlash = false
    inputEl?.focus()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (inputEl && handleTextareaCursorKeys(e, inputEl)) return
    if (showSlash) {
      const items = filteredSkills()
      const max = Math.max(0, items.length - 1)
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectedSlash = Math.min(selectedSlash + 1, max)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectedSlash = Math.max(selectedSlash - 1, 0)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (items[selectedSlash]) insertSlash(items[selectedSlash].name)
        return
      }
      if (e.key === 'Escape') {
        showSlash = false
        return
      }
    }
    if (showMentions) {
      const items = filteredMentions()
      if (e.key === 'ArrowDown') { e.preventDefault(); selectedMention = Math.min(selectedMention + 1, Math.max(0, items.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); selectedMention = Math.max(selectedMention - 1, 0); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (items[selectedMention]) insertMention(items[selectedMention]); return }
      if (e.key === 'Escape') { showMentions = false; return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const TEXTAREA_MIN_H = 38

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    const next = Math.max(TEXTAREA_MIN_H, Math.min(el.scrollHeight, 200))
    el.style.height = `${next}px`
  }

  export function focus() {
    inputEl?.focus()
  }

  /** Append to the draft (e.g. @wiki mention); focuses and resizes. */
  export function appendText(s: string) {
    if (!s) return
    const base = input
    const sep = base && !base.endsWith('\n') && !base.endsWith(' ') ? ' ' : ''
    input = base + sep + s
    void tick().then(() => {
      if (inputEl) {
        autoResize(inputEl)
        inputEl.focus()
        const len = input.length
        inputEl.setSelectionRange(len, len)
      }
    })
  }

  function submit() {
    const text = input.trim()
    if (!text) return
    if (disabled) return
    input = ''
    if (inputEl) inputEl.style.height = 'auto'
    onSend(text)
  }

  onMount(() => {
    void tick().then(() => {
      if (disabled) return
      inputEl?.focus({ preventScroll: true })
    })
  })

  $effect(() => {
    const cb = onDraftChange
    if (cb) cb(input)
  })
</script>

<div class="input-area" class:input-area--transparent={transparentSurround}>
  {#if showSlash}
    <div class="mention-dropdown slash-dropdown" role="listbox">
      {#each filteredSkills() as skill, i}
        <button
          type="button"
          class="mention-item slash-item"
          class:selected={i === selectedSlash}
          onmousedown={(e) => { e.preventDefault(); insertSlash(skill.slug) }}
        >
          <span class="slash-slash">/{skill.slug}</span>
          <span class="slash-label">{skill.label}</span>
        </button>
      {:else}
        <div class="mention-empty">No matching skills</div>
      {/each}
    </div>
  {/if}
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
      {#if queuedMessages.length > 0}
        <div class="queued-list" role="list" aria-label="Messages queued to send when assistant finishes">
          {#each queuedMessages as message, i (i)}
            <div class="queued-hint" role="listitem" title={message}>
              <span class="queued-icon" aria-hidden="true">
                <List size={14} strokeWidth={2.25} />
              </span>
              <span class="queued-text">{message}</span>
            </div>
          {/each}
        </div>
      {/if}
      <div class="input-composer">
        {#if onNewChat}
          <div class="lead-actions" role="group" aria-label="Start new chat">
            <button
              type="button"
              class="new-chat-btn"
              onclick={() => onNewChat()}
              title="New chat (⌘N)"
              aria-label="New chat"
            >
              <MessageSquarePlus size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        {/if}
        <div
          class="input-shell-inner"
          class:input-shell-inner--with-lead={!!onNewChat}
        >
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
        </div>
        <div class="send-actions" class:send-actions--streaming={streaming} role="group" aria-label={streaming ? 'Queue or stop assistant' : 'Send message'}>
          {#if streaming}
            <button type="button" class="send-btn stop-btn" onclick={() => onStop?.()} aria-label="Stop">
              <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          {/if}
          <button
            type="button"
            class="send-btn"
            onclick={submit}
            disabled={disabled || !input.trim()}
            title={streaming ? 'Queue message (sends when assistant finishes)' : undefined}
            aria-label={streaming ? 'Queue message to send when assistant finishes' : 'Send message'}
          >
            <ArrowUp size={20} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
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

  .input-area--transparent {
    background: transparent;
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

  .slash-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .slash-slash {
    font-weight: 600;
    color: var(--accent);
    flex-shrink: 0;
  }
  .slash-label {
    font-size: 12px;
    color: var(--text);
    flex-shrink: 0;
  }

  .input-row {
    display: flex;
    min-width: 0;
    width: 100%;
  }

  .queued-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 2px;
    min-width: 0;
    padding: 3px 10px 0;
  }

  .queued-hint {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 12px;
    line-height: 1.35;
    color: var(--text-2);
    padding: 0 2px 6px 2px;
    min-width: 0;
  }

  .queued-icon {
    flex-shrink: 0;
    margin-top: 1px;
    color: var(--accent);
    opacity: 0.95;
  }

  .queued-text {
    min-width: 0;
    flex: 1;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
    word-break: break-word;
  }

  .input-shell {
    flex: 1;
    min-width: 0;
    min-height: 42px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .input-shell:focus-within {
    border-color: var(--accent);
  }

  .input-composer {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    flex: 1;
    min-width: 0;
    min-height: 40px;
  }

  .lead-actions {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    align-self: stretch;
    flex-shrink: 0;
  }

  .new-chat-btn {
    --new-chat-r: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    min-width: 48px;
    width: 48px;
    padding: 0;
    border: none;
    border-right: 1px solid var(--border);
    border-radius: var(--new-chat-r) 0 0 var(--new-chat-r);
    background: var(--bg);
    color: var(--text-2);
    flex-shrink: 0;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  @media (hover: hover) {
    .new-chat-btn:hover {
      background: var(--bg-3);
      color: var(--text);
    }
  }

  .new-chat-btn:active {
    filter: brightness(0.97);
  }

  .input-shell-inner {
    display: flex;
    flex: 1;
    min-width: 0;
    padding: 3px 6px 3px 10px;
    align-items: flex-start;
  }

  .input-shell-inner--with-lead {
    padding-left: 8px;
  }

  .chat-textarea {
    flex: 1;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    resize: none;
    border: none;
    border-radius: 0;
    padding: 8px 2px 5px 2px;
    font: inherit;
    font-size: 16px;
    line-height: 1.4;
    background: transparent;
    color: var(--text);
    min-height: 38px;
    max-height: 200px;
  }

  .chat-textarea:focus {
    outline: none;
  }

  .chat-textarea:disabled {
    opacity: 0.6;
  }

  /* Inner radius: shell 10px minus 1px border */
  .send-btn {
    --send-btn-outer-r: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    min-width: 48px;
    width: 48px;
    padding: 0;
    border: none;
    border-radius: 0 var(--send-btn-outer-r) var(--send-btn-outer-r) 0;
    background: var(--accent);
    color: white;
    flex-shrink: 0;
    cursor: pointer;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .send-actions {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    align-self: stretch;
    flex-shrink: 0;
  }

  .send-actions .send-btn {
    width: 48px;
    min-width: 48px;
  }

  .send-actions--streaming .stop-btn {
    border-radius: 0;
    border-right: 1px solid rgba(255, 255, 255, 0.25);
  }

  .stop-btn {
    background: var(--text-2);
  }
  .stop-btn:hover {
    filter: brightness(1.1);
  }
</style>
