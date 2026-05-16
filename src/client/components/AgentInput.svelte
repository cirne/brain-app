<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { ArrowUp, AtSign, List, MessageSquarePlus, Mic, Square } from '@lucide/svelte'
  import WikiFileName from '@components/WikiFileName.svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
  import type { SkillMenuItem } from '@client/lib/agentUtils.js'
  import { handleTextareaCursorKeys } from '@client/lib/agentInputCursor.js'
  import {
    fetchWorkspaceHandleSuggestions,
    type WorkspaceHandleEntry,
  } from '@client/lib/workspaceHandleSuggest.js'

  let {
    placeholder = undefined as string | undefined,
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
     * When set, a "new chat" control is integrated on the left inside the bordered field (like send on the right).
     */
    onNewChat = undefined as (() => void) | undefined,
    /** Tap mic to open the voice panel; lead rail left of the textarea. */
    showVoiceEntry = false,
    onVoiceEntry = undefined as (() => void) | undefined,
    voiceEntryDisabled = false,
    /** Focus the field on mount (main chat composer); off for embedded surfaces (e.g. B2B review steering). */
    autoFocusOnMount = true,
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
    showVoiceEntry?: boolean
    onVoiceEntry?: () => void
    voiceEntryDisabled?: boolean
    autoFocusOnMount?: boolean
  } = $props()

  const resolvedPlaceholder = $derived(placeholder ?? $t('chat.input.placeholder'))

  let input = $state('')
  let inputEl: HTMLTextAreaElement
  let showMentions = $state(false)
  let mentionFilter = $state('')
  let mentionStart = $state(-1)
  let selectedMention = $state(0)

  /**
   * People matching the current `@` query (workspace-handle directory). Fetched
   * lazily; an empty list (offline / no matches / not loaded yet) collapses the
   * People section so behavior matches the docs-only menu when no one matches.
   */
  let peopleSuggestions = $state<WorkspaceHandleEntry[]>([])
  let peopleFetchToken = 0

  let showSlash = $state(false)
  let slashFilter = $state('')
  let selectedSlash = $state(0)

  type MentionRow =
    | { kind: 'person'; entry: WorkspaceHandleEntry }
    | { kind: 'doc'; path: string }

  function filteredDocMentions(): string[] {
    if (!mentionFilter) return wikiFiles.slice(0, 10)
    const q = mentionFilter.toLowerCase()
    return wikiFiles.filter(f => f.toLowerCase().includes(q)).slice(0, 10)
  }

  function mentionRows(): MentionRow[] {
    const people = peopleSuggestions.slice(0, 5).map<MentionRow>((entry) => ({ kind: 'person', entry }))
    const docs = filteredDocMentions().map<MentionRow>((path) => ({ kind: 'doc', path }))
    return [...people, ...docs]
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
        void refreshPeopleSuggestions(query)
        return
      }
    }
    showMentions = false
    peopleSuggestions = []

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

  function insertMention(row: MentionRow) {
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + mentionFilter.length + 1)
    const token =
      row.kind === 'person' ? `@${row.entry.handle}` : `@${row.path.replace(/^@+/, '')}`
    input = `${before}${token} ${after}`
    showMentions = false
    peopleSuggestions = []
    inputEl?.focus()
  }

  /**
   * Fetch matching workspace handles for `query`. Failures are silent — the
   * People section just collapses, leaving the existing docs-only mention menu
   * intact (so offline / unauthenticated environments behave identically to
   * the previous wiki-only picker).
   */
  async function refreshPeopleSuggestions(query: string) {
    const myToken = ++peopleFetchToken
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      peopleSuggestions = []
      return
    }
    const { token, results } = await fetchWorkspaceHandleSuggestions(trimmed, myToken)
    if (token !== peopleFetchToken) return
    peopleSuggestions = results
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
      const items = mentionRows()
      if (e.key === 'ArrowDown') { e.preventDefault(); selectedMention = Math.min(selectedMention + 1, Math.max(0, items.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); selectedMention = Math.max(selectedMention - 1, 0); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (items[selectedMention]) insertMention(items[selectedMention]); return }
      if (e.key === 'Escape') { showMentions = false; peopleSuggestions = []; return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  /** Cap growth so the composer does not eat the whole viewport; page can scroll instead of inner textarea scroll. */
  function textareaMaxHeightPx(): number {
    if (typeof window === 'undefined') return 480
    return Math.min(480, Math.floor(window.innerHeight * 0.55))
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    const cap = textareaMaxHeightPx()
    const next = Math.min(el.scrollHeight, cap)
    el.style.height = `${next}px`
  }

  $effect(() => {
    void input
    void resolvedPlaceholder
    void queuedMessages.length
    void tick().then(() => {
      if (inputEl) autoResize(inputEl)
    })
  })

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
    const onResize = () => {
      if (inputEl) autoResize(inputEl)
    }
    window.addEventListener('resize', onResize)
    void tick().then(() => {
      onResize()
      if (disabled || !autoFocusOnMount) return
      inputEl?.focus({ preventScroll: true })
    })
    return () => window.removeEventListener('resize', onResize)
  })

  $effect(() => {
    const cb = onDraftChange
    if (cb) cb(input)
  })

  // Shared button styles (preserve legacy class hooks for tests / external selectors).
  const sendBtnBase =
    'send-btn inline-flex shrink-0 cursor-pointer items-center justify-center self-stretch min-w-[48px] w-[48px] border-none bg-accent text-accent-foreground p-0 disabled:cursor-not-allowed disabled:opacity-40'
</script>

<div class={cn(
  'input-area relative shrink-0 px-0 py-1.5',
  transparentSurround ? 'input-area--transparent bg-transparent' : 'bg-surface',
)}>
  {#if showSlash}
    <div
      class="mention-dropdown slash-dropdown absolute bottom-full left-3 right-3 z-[3] mb-1 max-h-[200px] overflow-y-auto border border-border bg-surface-3 [box-shadow:0_-4px_12px_rgba(0,0,0,0.3)]"
      role="listbox"
    >
      {#each filteredSkills() as skill, i}
        <button
          type="button"
          class={cn(
            'mention-item slash-item flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-accent-dim hover:text-accent',
            i === selectedSlash && 'selected bg-accent-dim text-accent',
          )}
          onmousedown={(e) => { e.preventDefault(); insertSlash(skill.slug) }}
        >
          <span class="slash-slash shrink-0 font-semibold text-accent">/{skill.slug}</span>
          <span class="slash-label shrink-0 text-xs text-foreground">{skill.label}</span>
        </button>
      {:else}
        <div class="mention-empty px-3 py-2 text-xs text-muted">{$t('chat.input.noMatchingSkills')}</div>
      {/each}
    </div>
  {/if}
  {#if showMentions}
    {@const rows = mentionRows()}
    {@const peopleCount = peopleSuggestions.slice(0, 5).length}
    <div
      class="mention-dropdown absolute bottom-full left-3 right-3 z-[3] mb-1 max-h-[260px] overflow-y-auto border border-border bg-surface-3 [box-shadow:0_-4px_12px_rgba(0,0,0,0.3)]"
      role="listbox"
      aria-label={$t('chat.input.mentionMenuAria')}
    >
      {#if rows.length === 0}
        <div class="mention-empty px-3 py-2 text-xs text-muted">{$t('chat.input.noMentionMatches')}</div>
      {:else}
        {#if peopleCount > 0}
          <div
            class="mention-section-header px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted"
            role="presentation"
          >{$t('chat.input.mentionsPeople')}</div>
        {/if}
        {#each rows as row, i (row.kind === 'person' ? `p:${row.entry.userId}` : `d:${row.path}`)}
          {#if row.kind === 'person' && i === peopleCount - 0}
            <!-- no-op separator marker -->
          {/if}
          {#if row.kind === 'doc' && i === peopleCount && peopleCount > 0}
            <div
              class="mention-section-header px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted"
              role="presentation"
            >{$t('chat.input.mentionsDocuments')}</div>
          {/if}
          <button
            type="button"
            role="option"
            aria-selected={i === selectedMention}
            class={cn(
              'mention-item flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-accent-dim hover:text-accent',
              i === selectedMention && 'selected bg-accent-dim text-accent',
            )}
            onmousedown={(e) => { e.preventDefault(); insertMention(row) }}
          >
            {#if row.kind === 'person'}
              <span class="mention-person-icon shrink-0 text-muted" aria-hidden="true">
                <AtSign size={12} strokeWidth={2.25} />
              </span>
              <span class="mention-person-handle font-semibold">@{row.entry.handle}</span>
              {#if row.entry.displayName}
                <span class="mention-person-name truncate text-xs text-muted">{row.entry.displayName}</span>
              {/if}
            {:else}
              <WikiFileName path={row.path} />
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}

  <div class="input-row flex w-full min-w-0">
    <div class="input-shell flex flex-1 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface focus-within:border-accent">
      {#if queuedMessages.length > 0}
        <div
          class="queued-list mb-0.5 flex flex-col gap-1.5 min-w-0 px-2.5 pt-[3px]"
          role="list"
          aria-label={$t('chat.input.queuedMessagesAria')}
        >
          {#each queuedMessages as message, i (i)}
            <div
              class="queued-hint flex items-start gap-1.5 min-w-0 px-0.5 pb-1.5 text-xs leading-snug text-muted"
              role="listitem"
              title={message}
            >
              <span class="queued-icon shrink-0 mt-px text-accent opacity-95" aria-hidden="true">
                <List size={14} strokeWidth={2.25} />
              </span>
              <span
                class="queued-text min-w-0 flex-1 overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:3] [display:-webkit-box] [word-break:break-word]"
              >{message}</span>
            </div>
          {/each}
        </div>
      {/if}
      <div class="input-composer flex flex-1 min-w-0 flex-row items-stretch">
        {#if onNewChat}
          <div
            class="lead-actions flex shrink-0 flex-row items-stretch self-stretch"
            role="group"
            aria-label={$t('chat.input.startNewChatAria')}
          >
            <button
              type="button"
              class="new-chat-btn inline-flex shrink-0 cursor-pointer items-center justify-center self-stretch min-w-[48px] w-[48px] p-0 border-none border-r border-r-border bg-surface text-muted transition-colors hover:bg-surface-3 hover:text-foreground active:[filter:brightness(0.97)]"
              onclick={() => onNewChat()}
              title={$t('chat.input.newChatTitle')}
              aria-label={$t('chat.input.newChatAria')}
            >
              <MessageSquarePlus size={20} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        {/if}
        <div
          class={cn(
            'input-shell-inner flex flex-1 min-w-0 items-center py-1 pr-2 pl-2',
            onNewChat && 'input-shell-inner--with-lead pl-2',
          )}
        >
          <textarea
            class="chat-textarea w-full py-1 flex-1 box-border min-w-0 max-h-[min(480px,55vh)] resize-none border-none bg-transparent px-1 py-0 text-base leading-normal text-foreground [overflow-x:hidden] [overflow-y:hidden] placeholder:text-muted placeholder:opacity-80 focus:outline-none disabled:opacity-60"
            bind:this={inputEl}
            bind:value={input}
            oninput={handleInput}
            onkeydown={handleKeydown}
            placeholder={resolvedPlaceholder}
            rows="1"
            {disabled}
          ></textarea>
        </div>
        <div
          class={cn(
            'send-actions flex shrink-0 flex-row items-stretch self-stretch',
            streaming && 'send-actions--streaming [&_.stop-btn]:border-r [&_.stop-btn]:border-r-white/25',
          )}
          role="group"
          aria-label={streaming ? $t('chat.input.queueOrStopAria') : $t('chat.input.sendGroupAria')}
        >
          {#if streaming}
            <button
              type="button"
              class={cn(sendBtnBase, 'stop-btn bg-muted hover:[filter:brightness(1.1)]')}
              onclick={() => onStop?.()}
              aria-label={$t('chat.input.stopAria')}
            >
              <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
            <button
              type="button"
              class={sendBtnBase}
              onclick={submit}
              disabled={disabled || !input.trim()}
              title={$t('chat.input.queueMessageTitle')}
              aria-label={$t('chat.input.queueMessageAria')}
            >
              <ArrowUp size={20} strokeWidth={2.5} aria-hidden="true" />
            </button>
          {:else if showVoiceEntry && onVoiceEntry && !input.trim()}
            <button
              type="button"
              class={cn(sendBtnBase, 'voice-right-btn')}
              disabled={voiceEntryDisabled}
              onclick={() => onVoiceEntry()}
              title={$t('chat.input.voiceInputTitle')}
              aria-label={$t('chat.input.voiceInputAria')}
            >
              <Mic size={20} strokeWidth={2.25} aria-hidden="true" />
            </button>
          {:else}
            <button
              type="button"
              class={sendBtnBase}
              onclick={submit}
              disabled={disabled || !input.trim()}
              aria-label={$t('chat.input.sendMessageAria')}
            >
              <ArrowUp size={20} strokeWidth={2.5} aria-hidden="true" />
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  /* Match legacy ellipsis for long placeholders; avoid quirky `display` on ::placeholder (breaks baseline in some engines). */
  .chat-textarea::placeholder {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
