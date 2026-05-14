<script lang="ts">
  import { tick } from 'svelte'
  import { t } from '@client/lib/i18n/index.js'
  import { apiFetch } from '@client/lib/apiFetch.js'
  import { emit } from '@client/lib/app/appEvents.js'
  import { cn } from '@client/lib/cn.js'
  import { applyVoiceTranscriptToChat } from '@client/lib/voiceTranscribeRouting.js'
  import { isPressToTalkEnabled } from '@client/lib/pressToTalkEnabled.js'
  import UnifiedChatComposer from '@components/UnifiedChatComposer.svelte'
  import {
    fetchWorkspaceHandleSuggestions,
    looksLikeEmail,
    normalizeHandleInput,
    type WorkspaceHandleEntry,
  } from '@client/lib/workspaceHandleSuggest.js'

  type Props = {
    layout?: 'inline' | 'sheet'
    onDismiss: () => void
    onSubmitted: (_sessionId: string, _peerHandle: string) => void | Promise<void>
  }

  let { layout = 'inline', onDismiss, onSubmitted }: Props = $props()

  let query = $state('')
  let suggestions = $state<WorkspaceHandleEntry[]>([])
  let loading = $state(false)
  let activeIndex = $state(0)
  let selected = $state<WorkspaceHandleEntry | null>(null)
  let busy = $state(false)
  let err = $state<string | null>(null)
  let listOpen = $state(false)
  let token = 0
  let rootEl: HTMLDivElement | undefined = $state(undefined)
  let searchInputEl: HTMLInputElement | undefined = $state(undefined)
  let coldComposerRef = $state<ReturnType<typeof UnifiedChatComposer> | undefined>(undefined)
  let coldDraftForVoice = $state('')

  function onColdDraftChange(d: string): void {
    coldDraftForVoice = d
  }

  function appendToColdComposer(text: string): void {
    coldComposerRef?.appendText(text)
  }

  function restoreComposerDraft(trimmed: string): void {
    queueMicrotask(() => coldComposerRef?.appendText(trimmed))
  }

  function onColdTranscribe(text: string): void {
    applyVoiceTranscriptToChat(text, coldDraftForVoice, (t) => void sendColdQuery(t), appendToColdComposer)
  }

  async function refreshSuggestions(q: string): Promise<void> {
    const raw = q.trim()
    if (raw.length === 0) {
      suggestions = []
      loading = false
      return
    }
    const myToken = ++token
    loading = true
    const { token: tk, results } = await fetchWorkspaceHandleSuggestions(raw, myToken)
    if (tk !== token) return
    suggestions = results
    activeIndex = 0
    loading = false
  }

  function onSearchInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value
    query = v
    selected = null
    listOpen = true
    void refreshSuggestions(v)
  }

  function pick(entry: WorkspaceHandleEntry): void {
    selected = entry
    query = `@${entry.handle}`
    suggestions = []
    listOpen = false
    err = null
    void tick().then(() => coldComposerRef?.focus())
  }

  function clearRecipient(): void {
    selected = null
    query = ''
    suggestions = []
    listOpen = false
    queueMicrotask(() => searchInputEl?.focus())
  }

  function onSearchKeydown(e: KeyboardEvent): void {
    if (!listOpen || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex = Math.min(activeIndex + 1, suggestions.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex = Math.max(activeIndex - 1, 0)
    } else if (e.key === 'Enter') {
      const row = suggestions[activeIndex]
      if (row) {
        e.preventDefault()
        pick(row)
      }
    } else if (e.key === 'Escape') {
      listOpen = false
    }
  }

  function onDocPointerDown(ev: PointerEvent): void {
    if (!listOpen || !rootEl) return
    const el = ev.target as Node
    if (!rootEl.contains(el)) listOpen = false
  }

  $effect(() => {
    if (typeof document === 'undefined' || !listOpen) return
    const fn = (ev: PointerEvent) => onDocPointerDown(ev)
    document.addEventListener('pointerdown', fn, true)
    return () => document.removeEventListener('pointerdown', fn, true)
  })

  /** Shared by UnifiedChatComposer onSend + voice autosend (`applyVoiceTranscriptToChat`). */
  async function sendColdQuery(raw: string): Promise<void> {
    const trimmed = raw.trim()
    if (!trimmed) {
      err = $t('chat.history.coldQuery.error')
      return
    }

    let body: Record<string, string>
    if (selected) {
      body = { targetUserId: selected.userId, message: trimmed }
    } else {
      const q = query.trim()
      if (!q) {
        err = $t('chat.history.coldQuery.pickRecipientHint')
        restoreComposerDraft(trimmed)
        return
      }
      if (looksLikeEmail(q)) {
        body = { targetEmail: q.toLowerCase(), message: trimmed }
      } else {
        const handle = normalizeHandleInput(q)
        if (!handle) {
          err = $t('chat.history.coldQuery.pickRecipientHint')
          restoreComposerDraft(trimmed)
          return
        }
        body = { targetHandle: handle, message: trimmed }
      }
    }

    busy = true
    err = null
    try {
      const res = await apiFetch('/api/chat/b2b/cold-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 409) {
        err = $t('chat.history.coldQuery.grantExists')
        restoreComposerDraft(trimmed)
        return
      }
      if (res.status === 429) {
        err = $t('chat.history.coldQuery.rateLimited')
        restoreComposerDraft(trimmed)
        return
      }
      if (!res.ok) {
        err = $t('chat.history.coldQuery.error')
        restoreComposerDraft(trimmed)
        return
      }
      const j = (await res.json()) as { sessionId?: string }
      const sid = typeof j.sessionId === 'string' ? j.sessionId.trim() : ''
      if (!sid) {
        err = $t('chat.history.coldQuery.error')
        restoreComposerDraft(trimmed)
        return
      }
      emit({ type: 'b2b:review-changed' })
      await onSubmitted(sid, selected.handle)
    } catch {
      err = $t('chat.history.coldQuery.error')
      restoreComposerDraft(trimmed)
    } finally {
      busy = false
    }
  }
</script>

<div
  bind:this={rootEl}
  data-testid="cold-tunnel-composer"
  class={cn(
    'cold-tunnel-composer flex w-full max-w-[min(36rem,100%)] flex-col gap-3',
    layout === 'inline' && 'mx-auto px-[length:var(--chat-transcript-px)] pb-2',
    layout === 'sheet' && 'px-2',
  )}
>
  {#if layout === 'inline'}
    <h2 class="m-0 text-sm font-semibold text-foreground">
      {$t('chat.history.coldQuery.sheetTitle')}
    </h2>
  {/if}

  <section
    class="rounded-lg border border-border/80 bg-surface-2/50 p-3"
    aria-labelledby="cold-tunnel-intro-heading"
  >
    <h3 id="cold-tunnel-intro-heading" class="m-0 text-xs font-semibold text-foreground">
      {$t('chat.history.coldQuery.introHeading')}
    </h3>
    <p class="mt-1.5 text-xs leading-relaxed text-muted">
      {$t('chat.history.coldQuery.introLead')}
    </p>
  </section>

  {#if selected}
    <div
      class="rounded-md border border-border bg-surface px-3 py-2"
      aria-label={$t('chat.history.coldQuery.recipientCardAria')}
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-foreground">@{selected.handle}</div>
          <div class="mt-0.5 text-xs leading-snug text-muted">
            {#if selected.displayName?.trim()}
              {selected.displayName.trim()}
              {#if selected.primaryEmail}
                <span class="text-muted/80"> · {selected.primaryEmail}</span>
              {/if}
            {:else if selected.primaryEmail}
              {selected.primaryEmail}
            {/if}
          </div>
        </div>
        <button
          type="button"
          class="shrink-0 rounded border border-border bg-surface-3 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-surface-2"
          disabled={busy}
          onclick={clearRecipient}
        >
          {$t('chat.history.coldQuery.changeRecipient')}
        </button>
      </div>
    </div>
  {:else}
    <div class="relative flex flex-col gap-1">
      <label class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-muted" for="cold-tunnel-search">
        {$t('chat.history.coldQuery.recipientSearchLabel')}
      </label>
      <input
        bind:this={searchInputEl}
        id="cold-tunnel-search"
        type="text"
        class="box-border w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground"
        disabled={busy}
        placeholder={$t('chat.history.coldQuery.recipientSearchPlaceholder')}
        value={query}
        oninput={onSearchInput}
        onkeydown={onSearchKeydown}
        onfocus={() => {
          listOpen = true
          void refreshSuggestions(query)
        }}
        autocomplete="off"
        aria-autocomplete="list"
        aria-controls="cold-tunnel-suggest-list"
      />
      {#if listOpen && (suggestions.length > 0 || loading)}
        <div
          id="cold-tunnel-suggest-list"
          class="absolute left-0 right-0 top-full z-30 mt-1 max-h-[min(40vh,16rem)] overflow-y-auto rounded-md border border-border bg-surface shadow-lg"
          role="listbox"
        >
          {#if loading && suggestions.length === 0}
            <div class="px-3 py-2 text-xs text-muted">{$t('chat.history.coldQuery.searching')}</div>
          {:else if suggestions.length === 0}
            <div class="px-3 py-2 text-xs text-muted">{$t('chat.history.coldQuery.noMatches')}</div>
          {:else}
            {#each suggestions as s, i (s.userId)}
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                class={cn(
                  'flex w-full flex-col items-start gap-0.5 border-0 px-3 py-2 text-left [font:inherit] hover:bg-accent-dim',
                  i === activeIndex ? 'bg-accent-dim' : 'bg-transparent',
                )}
                onmousedown={(ev) => {
                  ev.preventDefault()
                  pick(s)
                }}
              >
                <span class="text-[0.8125rem] font-semibold text-foreground">@{s.handle}</span>
                <span class="text-[0.75rem] leading-snug text-muted">
                  {#if s.displayName?.trim()}
                    {s.displayName.trim()}
                    {#if s.primaryEmail}
                      · {s.primaryEmail}
                    {/if}
                  {:else if s.primaryEmail}
                    {s.primaryEmail}
                  {/if}
                </span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <div class="flex min-w-0 flex-col gap-1" role="group" aria-labelledby="cold-tunnel-msg-label">
    <span id="cold-tunnel-msg-label" class="m-0 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
      {$t('chat.history.coldQuery.messageLabel')}
    </span>
    <UnifiedChatComposer
      bind:this={coldComposerRef}
      voiceEligible={isPressToTalkEnabled()}
      sessionResetKey="cold-tunnel"
      placeholder={$t('chat.history.coldQuery.messagePlaceholder')}
      wikiFiles={[]}
      skills={[]}
      streaming={false}
      transparentSurround={true}
      inputDisabled={busy}
      autoFocusInputOnMount={false}
      onDraftChange={onColdDraftChange}
      onSend={(text) => void sendColdQuery(text)}
      onTranscribe={onColdTranscribe}
      onRequestFocusText={() => void tick().then(() => coldComposerRef?.focus())}
    />
  </div>

  {#if err}
    <p class="m-0 text-xs text-danger" role="alert">{err}</p>
  {/if}

  <div class="flex flex-wrap justify-end gap-2">
    <button
      type="button"
      class="rounded-md border border-border bg-surface-3 px-3 py-[0.4rem] text-xs font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
      disabled={busy}
      onclick={() => {
        err = null
        onDismiss()
      }}
    >
      {$t('common.actions.cancel')}
    </button>
  </div>
</div>
