<script lang="ts">
  /**
   * Ripmail draft: metadata fields + shared Markdown editor; PATCH saves literal body via draft rewrite.
   */
  import { onDestroy, onMount } from 'svelte'
  import { Loader2 } from 'lucide-svelte'
  import TipTapMarkdownEditor from '@components/TipTapMarkdownEditor.svelte'
  import { subscribe, emit } from '@client/lib/app/appEvents.js'
  import type { SurfaceContext } from '@client/router.js'
  import { getEmailDraftHeaderCell } from '@client/lib/emailDraftSlideHeaderContext.js'
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

  const emailDraftHeaderCell = getEmailDraftHeaderCell()

  /** Stable handlers for the header — function declarations below are hoisted; identities don't change. */
  function emailDraftHeaderSave() {
    void saveDraft()
  }
  function emailDraftHeaderSend() {
    void sendDraft()
  }

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

  /**
   * Claim/release the draft header cell as the editor moves in/out of a usable state.
   * Stable handlers (`discard`, `emailDraftHeaderSave`, `emailDraftHeaderSend`) are passed
   * once at claim time; reactive scalars (`saveState`, `sendState`) flow via `patch`.
   * See archived BUG-047 (effect depth / slide headers).
   */
  let emailDraftHeaderCtrl:
    | ReturnType<NonNullable<typeof emailDraftHeaderCell>['claim']>
    | null = null
  const emailDraftHeaderShouldShow = $derived(!loading && !loadError)

  $effect(() => {
    if (!emailDraftHeaderCell) return
    if (emailDraftHeaderShouldShow) {
      if (!emailDraftHeaderCtrl?.isOwner) {
        emailDraftHeaderCtrl = emailDraftHeaderCell.claim({
          onDiscard: discard,
          onSave: emailDraftHeaderSave,
          onSend: emailDraftHeaderSend,
          saveState,
          sendState,
        })
      } else {
        emailDraftHeaderCtrl.patch({ saveState, sendState })
      }
    } else if (emailDraftHeaderCtrl) {
      emailDraftHeaderCtrl.clear()
      emailDraftHeaderCtrl = null
    }
  })

  onDestroy(() => {
    emailDraftHeaderCtrl?.clear()
    emailDraftHeaderCtrl = null
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

  const metaInputClass =
    'meta-input box-border min-h-[30px] w-full min-w-0 border border-[color-mix(in_srgb,var(--border)_85%,transparent)] bg-surface px-2 py-[5px] text-[13px] leading-snug text-foreground [font-family:inherit] focus:border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] focus:outline-none focus:[box-shadow:0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)] placeholder:text-[color-mix(in_srgb,var(--text-2)_65%,transparent)]'

  const metaKeyClass =
    'meta-key m-0 self-center pr-0.5 text-right text-[11px] font-semibold uppercase leading-tight tracking-[0.04em] text-muted'

  const metaRowClass =
    'meta-row box-border grid min-h-8 grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-[0.65rem] gap-y-2 px-0 py-[3px]'
</script>

<div
  class="email-draft-editor box-border flex min-h-0 flex-1 flex-col px-3 pb-3 pt-0"
  data-testid="email-draft-editor"
>
  {#if loading}
    <div class="draft-loading flex items-center gap-2.5 p-6 text-muted">
      <Loader2 size={22} class="spin" aria-hidden="true" />
      <span>Loading draft…</span>
    </div>
  {:else if loadError}
    <p class="draft-load-error m-0 mb-2 shrink-0 px-0.5 text-[13px] text-[var(--danger,#c62828)]" role="alert">{loadError}</p>
  {:else}
    <div
      class="draft-meta mb-1.5 flex shrink-0 flex-col gap-0 border-b border-[color-mix(in_srgb,var(--border)_70%,transparent)] pb-2"
      aria-label="Draft recipients and subject"
    >
      <div class={metaRowClass}>
        <label class={metaKeyClass} for="email-draft-to">To</label>
        <input
          id="email-draft-to"
          class={metaInputClass}
          type="text"
          bind:value={toLine}
          autocomplete="off"
          placeholder="Recipients"
        />
      </div>
      <div class={metaRowClass}>
        <label class={metaKeyClass} for="email-draft-subject">Subject</label>
        <input
          id="email-draft-subject"
          class={metaInputClass}
          type="text"
          bind:value={subject}
          autocomplete="off"
          placeholder="Subject"
        />
      </div>
      <details class="meta-cc-bcc m-0 border-none p-0" bind:open={ccBccOpen}>
        <summary
          class="meta-cc-bcc-summary cursor-pointer select-none list-none pb-1.5 pl-[calc(3.75rem+0.65rem)] pr-0 pt-[5px] text-[11px] font-semibold tracking-[0.03em] text-muted transition-colors duration-100 hover:text-foreground"
        >Cc · Bcc</summary>
        <div class="{metaRowClass} meta-row--nested pl-0 [.meta-cc-bcc_&:first-of-type]:pt-0.5">
          <label class={metaKeyClass} for="email-draft-cc">Cc</label>
          <input
            id="email-draft-cc"
            class={metaInputClass}
            type="text"
            bind:value={ccLine}
            autocomplete="off"
            placeholder="Optional"
          />
        </div>
        <div class="{metaRowClass} meta-row--nested pl-0">
          <label class={metaKeyClass} for="email-draft-bcc">Bcc</label>
          <input
            id="email-draft-bcc"
            class={metaInputClass}
            type="text"
            bind:value={bccLine}
            autocomplete="off"
            placeholder="Optional"
          />
        </div>
      </details>
    </div>

    {#if actionError}
      <p
        class="draft-action-error m-0 mb-2 shrink-0 px-0.5 text-[13px] text-[var(--danger,#c62828)]"
        role="alert"
      >{actionError}</p>
    {/if}

    <div class="draft-body-scroll flex min-h-0 flex-1 flex-col overflow-hidden">
      {#key editorKey}
        <div class="draft-editor-wrap flex min-h-0 flex-1 flex-col overflow-hidden">
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
  /* Spinner uses the lucide `class="spin"` prop (not Tailwind-mergeable) plus a custom keyframe. */
  .draft-loading :global(.spin) {
    animation: spin 0.85s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Hide native disclosure marker — Tailwind cannot reliably target ::-webkit-details-marker. */
  .meta-cc-bcc-summary::-webkit-details-marker {
    display: none;
  }

  /* Inline “▸” affordance via an ::before pseudo (rotates when open). */
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
</style>
