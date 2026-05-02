<script lang="ts">
  /**
   * Ripmail draft: metadata fields + shared Markdown editor; PATCH saves literal body via draft rewrite.
   */
  import { getContext, onMount } from 'svelte'
  import { Loader2 } from 'lucide-svelte'
  import TipTapMarkdownEditor from './TipTapMarkdownEditor.svelte'
  import { subscribe, emit } from '@client/lib/app/appEvents.js'
  import type { SurfaceContext } from '@client/router.js'
  import {
    EMAIL_DRAFT_HEADER,
    type RegisterEmailDraftHeader,
  } from '@client/lib/emailDraftSlideHeaderContext.js'
  import '../styles/wiki/wikiMarkdown.css'

  type DraftJson = {
    id?: string
    subject?: string
    body?: string
    to?: string[]
    cc?: string[]
    bcc?: string[]
    sourceMessageId?: string
  }

  let {
    draftId,
    onContextChange,
    onReturnToThread,
    onClosePanel,
  }: {
    draftId?: string
    onContextChange?: (_ctx: SurfaceContext) => void
    onReturnToThread?: (_messageId: string) => void
    onClosePanel?: () => void
  } = $props()

  let subject = $state('')
  let toLine = $state('')
  let ccLine = $state('')
  let bccLine = $state('')
  let bodyMd = $state('')
  let editorKey = $state(0)
  let loading = $state(true)
  let loadError = $state<string | null>(null)
  let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle')
  let sendState = $state<'idle' | 'sending' | 'error'>('idle')
  let actionError = $state<string | null>(null)
  let sourceThreadId = $state<string | null>(null)

  let mdEditor = $state<TipTapMarkdownEditor | undefined>()
  /** Expanded Cc/Bcc block; opens automatically when draft has Cc or Bcc. */
  let ccBccOpen = $state(false)

  const registerEmailDraftHeader = getContext<RegisterEmailDraftHeader | undefined>(EMAIL_DRAFT_HEADER)

  function addrsToLine(v: string[] | undefined): string {
    return Array.isArray(v) ? v.join(', ') : ''
  }

  function lineToAddrs(line: string): string[] {
    return line.split(',').map((s) => s.trim()).filter(Boolean)
  }

  function pushContext(id: string) {
    onContextChange?.({
      type: 'email-draft',
      draftId: id,
      subject: subject.trim() || '(loading)',
      toLine: toLine.trim(),
      bodyPreview: bodyMd.trim().slice(0, 800),
    })
  }

  function applyDraftJson(d: DraftJson) {
    subject = typeof d.subject === 'string' ? d.subject : ''
    toLine = addrsToLine(d.to)
    ccLine = addrsToLine(d.cc)
    bccLine = addrsToLine(d.bcc)
    ccBccOpen = Boolean(ccLine.trim() || bccLine.trim())
    bodyMd = typeof d.body === 'string' ? d.body : ''
    sourceThreadId = typeof d.sourceMessageId === 'string' ? d.sourceMessageId.trim() : null
    editorKey += 1
    const id = (typeof d.id === 'string' ? d.id.trim() : '') || (draftId?.trim() ?? '')
    if (id) pushContext(id)
  }

  export async function loadDraft() {
    const id = draftId?.trim()
    if (!id) {
      loading = false
      loadError = 'No draft selected.'
      return
    }
    loading = true
    loadError = null
    sendState = 'idle'
    try {
      const res = await fetch(`/api/inbox/draft/${encodeURIComponent(id)}`)
      const data = (await res.json()) as DraftJson & { error?: string }
      if (!res.ok || data.error) {
        loadError =
          typeof data.error === 'string' ? data.error : `Could not load draft (${res.status}).`
        loading = false
        return
      }
      applyDraftJson(data)
      loading = false
    } catch (e) {
      loadError = String(e)
      loading = false
    }
  }

  async function patchDraft(): Promise<boolean> {
    const id = draftId?.trim()
    if (!id) return false
    mdEditor?.cancelDebouncedSave()
    const md = mdEditor?.serializeMarkdown() ?? bodyMd
    saveState = 'saving'
    actionError = null
    try {
      const res = await fetch(`/api/inbox/draft/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: md,
          subject: subject.trim(),
          to: lineToAddrs(toLine),
          cc: lineToAddrs(ccLine),
          bcc: lineToAddrs(bccLine),
        }),
      })
      const data = (await res.json()) as DraftJson & { error?: string }
      if (!res.ok || data.error) {
        saveState = 'error'
        actionError = typeof data.error === 'string' ? data.error : 'Save failed'
        return false
      }
      applyDraftJson(data)
      saveState = 'saved'
      setTimeout(() => {
        if (saveState === 'saved') saveState = 'idle'
      }, 1600)
      return true
    } catch (e) {
      saveState = 'error'
      actionError = String(e)
      return false
    }
  }

  export async function saveDraft() {
    await patchDraft()
  }

  export async function sendDraft() {
    const id = draftId?.trim()
    if (!id) return
    sendState = 'sending'
    actionError = null
    const okSave = await patchDraft()
    if (!okSave) {
      sendState = 'error'
      return
    }
    try {
      const sendRes = await fetch(`/api/inbox/draft/${encodeURIComponent(id)}/send`, { method: 'POST' })
      const sendJson = (await sendRes.json()) as { ok?: boolean; error?: string }
      if (!sendRes.ok || sendJson.ok === false) {
        sendState = 'error'
        actionError = typeof sendJson.error === 'string' ? sendJson.error : 'Send failed'
        return
      }
      sendState = 'idle'
      emit({ type: 'sync:completed' })
      onClosePanel?.()
    } catch (e) {
      sendState = 'error'
      actionError = String(e)
    }
  }

  function discard() {
    if (sourceThreadId && onReturnToThread) {
      onReturnToThread(sourceThreadId)
      return
    }
    onClosePanel?.()
  }

  $effect(() => {
    const id = draftId?.trim()
    if (!id) return
    void loadDraft()
  })

  $effect(() => {
    if (loading || loadError) {
      registerEmailDraftHeader?.(null)
      return () => registerEmailDraftHeader?.(null)
    }
    registerEmailDraftHeader?.({
      onDiscard: discard,
      onSave: () => void saveDraft(),
      onSend: () => void sendDraft(),
      saveState,
      sendState,
    })
    return () => registerEmailDraftHeader?.(null)
  })

  onMount(() => {
    const unsub = subscribe((e) => {
      if (e.type !== 'email-draft:refresh') return
      const cur = draftId?.trim()
      if (!cur || e.draftId !== cur) return
      void loadDraft()
    })
    return unsub
  })
</script>

<div class="email-draft-editor" data-testid="email-draft-editor">
  {#if loading}
    <div class="draft-loading">
      <Loader2 size={22} class="spin" aria-hidden="true" />
      <span>Loading draft…</span>
    </div>
  {:else if loadError}
    <p class="draft-load-error" role="alert">{loadError}</p>
  {:else}
    <div class="draft-meta" aria-label="Draft recipients and subject">
      <div class="meta-row">
        <label class="meta-key" for="email-draft-to">To</label>
        <input
          id="email-draft-to"
          class="meta-input"
          type="text"
          bind:value={toLine}
          autocomplete="off"
          placeholder="Recipients"
        />
      </div>
      <div class="meta-row">
        <label class="meta-key" for="email-draft-subject">Subject</label>
        <input id="email-draft-subject" class="meta-input" type="text" bind:value={subject} autocomplete="off" placeholder="Subject" />
      </div>
      <details class="meta-cc-bcc" bind:open={ccBccOpen}>
        <summary class="meta-cc-bcc-summary">Cc · Bcc</summary>
        <div class="meta-row meta-row--nested">
          <label class="meta-key" for="email-draft-cc">Cc</label>
          <input id="email-draft-cc" class="meta-input" type="text" bind:value={ccLine} autocomplete="off" placeholder="Optional" />
        </div>
        <div class="meta-row meta-row--nested">
          <label class="meta-key" for="email-draft-bcc">Bcc</label>
          <input id="email-draft-bcc" class="meta-input" type="text" bind:value={bccLine} autocomplete="off" placeholder="Optional" />
        </div>
      </details>
    </div>

    {#if actionError}
      <p class="draft-action-error" role="alert">{actionError}</p>
    {/if}

    <div class="draft-body-scroll">
      {#key editorKey}
        <div class="draft-editor-wrap">
          <TipTapMarkdownEditor
            bind:this={mdEditor}
            initialMarkdown={bodyMd}
            disabled={sendState === 'sending'}
            autoPersist={false}
          />
        </div>
      {/key}
    </div>
  {/if}
</div>

<style>
  .email-draft-editor {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 0 12px 12px;
    box-sizing: border-box;
  }

  .draft-loading {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 24px;
    color: var(--text-2);
  }

  .draft-loading :global(.spin) {
    animation: spin 0.85s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .draft-load-error,
  .draft-action-error {
    color: var(--danger, #c62828);
    margin: 0 0 8px;
    padding: 0 2px;
    font-size: 13px;
    flex-shrink: 0;
  }

  .draft-meta {
    flex-shrink: 0;
    padding: 0 0 8px;
    margin-bottom: 6px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .meta-row {
    display: grid;
    grid-template-columns: 3.75rem minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem 0.65rem;
    min-height: 2rem;
    padding: 3px 0;
    box-sizing: border-box;
  }

  .meta-row--nested {
    padding-left: 0;
  }

  .meta-key {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-2);
    text-align: right;
    line-height: 1.2;
    align-self: center;
    padding-right: 2px;
  }

  .meta-input {
    font-family: inherit;
    font-size: 13px;
    line-height: 1.35;
    padding: 5px 8px;
    min-height: 30px;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
background: var(--bg);
    color: var(--text);
    width: 100%;
    min-width: 0;
  }

  .meta-input:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .meta-input::placeholder {
    color: color-mix(in srgb, var(--text-2) 65%, transparent);
  }

  .meta-cc-bcc {
    margin: 0;
    padding: 0;
    border: none;
  }

  .meta-cc-bcc-summary {
    list-style: none;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--text-2);
    padding: 5px 0 6px calc(3.75rem + 0.65rem);
    user-select: none;
    transition: color 0.12s ease;
  }

  .meta-cc-bcc-summary::-webkit-details-marker {
    display: none;
  }

  .meta-cc-bcc-summary::before {
    content: '';
    display: inline-block;
    width: 0.35em;
    height: 0.35em;
    margin-right: 0.35em;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(-45deg) translateY(-0.05em);
    vertical-align: middle;
    opacity: 0.65;
    transition: transform 0.15s ease;
  }

  .meta-cc-bcc[open] > .meta-cc-bcc-summary::before {
    transform: rotate(45deg) translateY(-0.05em);
  }

  .meta-cc-bcc-summary:hover {
    color: var(--text);
  }

  .meta-cc-bcc .meta-row--nested:first-of-type {
    padding-top: 2px;
  }

  .draft-body-scroll {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .draft-editor-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

</style>
