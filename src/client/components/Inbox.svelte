<script lang="ts">
  import { getContext, onMount, tick, untrack } from 'svelte'
  import { Archive, Forward, Reply, Search, Sparkles } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { emit, subscribe } from '@client/lib/app/appEvents.js'
  import { navigate, parseRoute, readTailFromCache, type Overlay, type SurfaceContext } from '@client/router.js'
  import { emailHeadersForDisplay } from '@client/lib/inboxHeaders.js'
  import { formatDate } from '@client/lib/formatDate.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  import { emailBodyToIframeSrcdoc } from '@client/lib/mailBodyDisplay.js'
  import { locationShowsEmailThread } from '@client/lib/inboxEmailLocation.js'
  import {
    INBOX_THREAD_HEADER,
    type RegisterInboxThreadHeader,
  } from '@client/lib/inboxSlideHeaderContext.js'

  type Email = {
    id: string
    from: string
    subject: string
    date: string
    read: boolean
  }

  type Contact = {
    firstname: string
    lastname: string
    primaryAddress: string
  }

  function navInboxEmail(overlay: Extract<Overlay, { type: 'email' }>) {
    const r = parseRoute()
    const sid =
      r.sessionId ?? (r.sessionTail ? readTailFromCache(r.sessionTail) : undefined)
    navigate({
      hubActive: r.hubActive === true,
      ...(r.hubActive ? {} : sid ? { sessionId: sid } : {}),
      overlay,
    })
  }

  function navEmailDraft(overlay: Extract<Overlay, { type: 'email-draft' }>) {
    const r = parseRoute()
    const sid =
      r.sessionId ?? (r.sessionTail ? readTailFromCache(r.sessionTail) : undefined)
    navigate({
      hubActive: r.hubActive === true,
      ...(r.hubActive ? {} : sid ? { sessionId: sid } : {}),
      overlay,
    })
  }

  let {
    initialId,
    targetId,
    onNavigate,
    onContextChange,
    onOpenSearch,
    onSummarizeInbox,
  }: {
    initialId?: string
    targetId?: string
    onNavigate?: (_id: string | undefined) => void
    onContextChange?: (_ctx: SurfaceContext) => void
    onOpenSearch?: () => void
    /** Starts a new agent chat with a prompt to summarize current inbox items */
    onSummarizeInbox?: (_message: string) => void
  } = $props()

  let emails = $state<Email[]>([])
  /** True until the first /api/inbox response completes (success or error). */
  let inboxListLoading = $state(true)
  let syncing = $state(false)
  let selectedThread = $state<string | null>(null)
  let threadContent = $state<{ headers: string; body: string } | null>(null)

  const threadIframeSrcdoc = $derived(
    threadContent?.body != null ? emailBodyToIframeSrcdoc(threadContent.body) : '',
  )

  /** Size iframe to document height so the thread pane scrolls as one surface (no nested iframe scrollbars). */
  function iframeAutoHeight(node: HTMLIFrameElement) {
    let ro: ResizeObserver | undefined
    const resize = () => {
      try {
        const doc = node.contentDocument
        if (!doc?.documentElement) return
        const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0)
        if (h > 0) node.style.height = `${h}px`
      } catch {
        /* sandbox / opaque */
      }
    }
    const onLoad = () => {
      ro?.disconnect()
      ro = undefined
      resize()
      try {
        const bodyEl = node.contentDocument?.body
        if (bodyEl && typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => resize())
          ro.observe(bodyEl)
        }
      } catch {
        /* */
      }
    }
    node.addEventListener('load', onLoad)
    queueMicrotask(resize)
    return {
      destroy() {
        node.removeEventListener('load', onLoad)
        ro?.disconnect()
      },
    }
  }

  let threadLoading = $state(false)
  /** Set when GET /api/inbox/:id fails (e.g. 404 — invalid or stale id). */
  let threadLoadError = $state<string | null>(null)
  const threadOpenLatest = createAsyncLatest({ abortPrevious: true })
  /** When opening by id that is not in the inbox list (e.g. agent **`read_mail_message`** id). */
  let orphanThreadMeta = $state<{ subject: string; from: string } | null>(null)
  let error = $state<string | null>(null)

  let composeMode = $state<'reply' | 'forward' | null>(null)
  let composeEmailId = $state<string | null>(null)
  let composeInstruction = $state('')
  let composeTo = $state('')
  let composing = $state(false)
  let composeError = $state<string | null>(null)

  /** Thread header rows with long values (To/Cc/…) — collapsed to 3 lines with optional expand. */
  let headerExpanded = $state<Record<string, boolean>>({})
  let headerOverflow = $state<Record<string, boolean>>({})
  const headerValueRefs: Record<string, HTMLElement> = {}

  function headerValueRef(node: HTMLElement, key: string) {
    headerValueRefs[key] = node
    return {
      destroy() {
        delete headerValueRefs[key]
      },
    }
  }

  function toggleHeaderRow(key: string) {
    headerExpanded = { ...headerExpanded, [key]: !headerExpanded[key] }
  }

  let contacts = $state<Contact[]>([])
  let contactsLoaded = $state(false)

  let filteredContacts = $derived(
    composeTo.length < 2
      ? []
      : contacts.filter(c => {
          const q = composeTo.toLowerCase()
          return (
            `${c.firstname} ${c.lastname}`.toLowerCase().includes(q) ||
            c.primaryAddress.toLowerCase().includes(q)
          )
        }).slice(0, 6)
  )

  let selectedEmail = $derived.by((): Email | null => {
    if (!selectedThread) return null
    const e = emails.find(x => x.id === selectedThread)
    if (e) return e
    if (orphanThreadMeta) {
      return {
        id: selectedThread,
        from: orphanThreadMeta.from,
        subject: orphanThreadMeta.subject,
        date: '',
        read: true,
      }
    }
    return null
  })

  async function load() {
    try {
      const res = await fetch('/api/inbox')
      if (res.ok) {
        emails = await res.json()
        error = null
      } else {
        error = 'Failed to load inbox'
      }
    } catch {
      error = 'Could not connect to inbox'
      emails = []
    } finally {
      inboxListLoading = false
    }
  }

  async function sync() {
    syncing = true
    try {
      await fetch('/api/inbox/sync', { method: 'POST' })
      await load()
    } catch {
      error = 'Sync failed'
    }
    syncing = false
  }

  function buildInboxSummarizeMessage(): string {
    const header =
      'Summarize my current inbox. For each thread give a one-line summary; then overall themes and anything urgent or actionable. Use read_mail_message with the message ids below to read bodies when needed (or search_index).'
    if (emails.length === 0) {
      return `${header}\n\nThe inbox list is currently empty (no rows after refresh).`
    }
    const lines = emails.map(
      (e, i) =>
        `${i + 1}. id=${JSON.stringify(e.id)} | From: ${e.from} | Subject: ${e.subject} | Date: ${e.date}`
    )
    return `${header}\n\nInbox (${emails.length} items):\n${lines.join('\n')}`
  }

  function summarizeInbox() {
    onSummarizeInbox?.(buildInboxSummarizeMessage())
  }

  async function archive(id: string) {
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(id)}/archive`, { method: 'POST' })
      if (!res.ok) return
      emails = emails.filter(e => e.id !== id)
      if (selectedThread === id) { selectedThread = null; threadContent = null }
      emit({ type: 'inbox:archived', messageId: id })
    } catch { /* ignore */ }
  }

  function applyExternalArchive(id: string) {
    if (!emails.some(e => e.id === id)) return
    emails = emails.filter(e => e.id !== id)
    if (selectedThread === id) { selectedThread = null; threadContent = null }
  }

  async function markRead(id: string) {
    await fetch(`/api/inbox/${encodeURIComponent(id)}/read`, { method: 'POST' })
    emails = emails.map(e => e.id === id ? { ...e, read: true } : e)
  }

  function parseEmailHeaders(headerText: string): { subject: string; from: string } {
    let subject = '(no subject)'
    let from = ''
    for (const line of headerText.split('\n')) {
      const sub = line.match(/^Subject:\s*(.*)$/i)
      if (sub) subject = sub[1].trim()
      const fr = line.match(/^From:\s*(.*)$/i)
      if (fr) from = fr[1].trim()
    }
    return { subject, from }
  }

  /** 404 can be transient right after sync / new mail; brief retries match “refresh fixes it”. */
  async function fetchInboxMessageForOpen(messageId: string, signal: AbortSignal): Promise<Response> {
    const url = `/api/inbox/${encodeURIComponent(messageId)}`
    const delayMs = [0, 400, 900]
    let last: Response | undefined
    for (const d of delayMs) {
      if (d > 0) await new Promise((r) => setTimeout(r, d))
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      last = await fetch(url, { signal })
      if (last.ok || last.status !== 404) return last
    }
    return last!
  }

  /** Open thread by id when the message is not in the current inbox list (IDs still valid for ripmail read). */
  async function openThreadByRawId(id: string) {
    if (selectedThread === id && (threadContent || threadLoading)) return
    const { token, signal } = threadOpenLatest.begin()
    orphanThreadMeta = null
    threadLoadError = null
    selectedThread = id
    /** Parent (`onInboxNavigateSlide`) already runs `navigateShell` + `parseRoute` — do not also call `navInboxEmail` or we double-replace history and loop Svelte effects. */
    if (onNavigate) {
      const skip =
        typeof location !== 'undefined' && locationShowsEmailThread(location.href, id)
      if (!skip) onNavigate(id)
    } else {
      navInboxEmail({ type: 'email', id })
    }
    onContextChange?.({ type: 'email', threadId: id, subject: '(loading)', from: '' })
    threadLoading = true
    try {
      const res = await fetchInboxMessageForOpen(id, signal)
      if (threadOpenLatest.isStale(token)) return
      if (res.ok) {
        const text = await res.text()
        if (threadOpenLatest.isStale(token)) return
        const blank = text.indexOf('\n\n')
        const headers = blank === -1 ? '' : text.slice(0, blank)
        const body = blank === -1 ? text : text.slice(blank + 2)
        threadContent =
          blank === -1 ? { headers: '', body: text } : { headers, body: body }
        const meta = headers ? parseEmailHeaders(headers) : { subject: '(no subject)', from: '' }
        orphanThreadMeta = meta
        onContextChange?.({
          type: 'email',
          threadId: id,
          subject: meta.subject,
          from: meta.from,
          body: (blank === -1 ? text : body).slice(0, 4000),
        })
        try {
          await markRead(id)
        } catch {
          /* id may not be in inbox index */
        }
        if (threadOpenLatest.isStale(token)) return
      } else {
        if (threadOpenLatest.isStale(token)) return
        threadContent = null
        threadLoadError =
          res.status === 404
            ? 'Message not found. It may have been archived or the id is invalid. Try refreshing the inbox list.'
            : `Could not load message (${res.status}).`
      }
    } catch (e) {
      if (threadOpenLatest.isStale(token) || isAbortError(e)) return
      threadContent = null
      threadLoadError = 'Could not load message.'
    } finally {
      if (!threadOpenLatest.isStale(token)) threadLoading = false
    }
  }

  async function openThread(email: Email) {
    orphanThreadMeta = null
    threadLoadError = null
    selectedThread = email.id
    if (onNavigate) {
      const skip =
        typeof location !== 'undefined' && locationShowsEmailThread(location.href, email.id)
      if (!skip) onNavigate(email.id)
    } else {
      navInboxEmail({ type: 'email', id: email.id })
    }
    onContextChange?.({ type: 'email', threadId: email.id, subject: email.subject, from: email.from })
    const { token, signal } = threadOpenLatest.begin()
    threadLoading = true
    try {
      await markRead(email.id)
      if (threadOpenLatest.isStale(token)) return
      const res = await fetchInboxMessageForOpen(email.id, signal)
      if (threadOpenLatest.isStale(token)) return
      if (res.ok) {
        const text = await res.text()
        if (threadOpenLatest.isStale(token)) return
        const blank = text.indexOf('\n\n')
        threadContent = blank === -1
          ? { headers: '', body: text }
          : { headers: text.slice(0, blank), body: text.slice(blank + 2) }
        onContextChange?.({ type: 'email', threadId: email.id, subject: email.subject, from: email.from, body: threadContent.body.slice(0, 4000) })
      } else {
        if (threadOpenLatest.isStale(token)) return
        threadContent = null
        threadLoadError =
          res.status === 404
            ? 'Message not found. It may have been archived or the id is invalid. Try refreshing the inbox list.'
            : `Could not load message (${res.status}).`
      }
    } catch (e) {
      if (threadOpenLatest.isStale(token) || isAbortError(e)) return
      threadContent = null
      threadLoadError = 'Could not load message.'
    } finally {
      if (!threadOpenLatest.isStale(token)) threadLoading = false
    }
  }

  async function loadContacts() {
    if (contactsLoaded) return
    try {
      const res = await fetch('/api/inbox/who')
      if (res.ok) contacts = await res.json()
      contactsLoaded = true
    } catch { /* ignore */ }
  }

  function startCompose(action: 'reply' | 'forward', email: Email) {
    composeMode = action
    composeEmailId = email.id
    composeInstruction = ''
    composeTo = ''
    composeError = null
    if (action === 'forward') loadContacts()
    if (selectedThread !== email.id) openThread(email)
  }

  function startComposeFromThread(action: 'reply' | 'forward') {
    const id = selectedEmail?.id ?? selectedThread
    if (!id) return
    composeMode = action
    composeEmailId = id
    composeInstruction = ''
    composeTo = ''
    composeError = null
    if (action === 'forward') loadContacts()
  }

  function cancelCompose() {
    composeMode = null
    composeEmailId = null
    composeError = null
  }

  async function createDraft() {
    if (!composeMode || !composeEmailId || !composeInstruction.trim()) return
    if (composeMode === 'forward' && !composeTo.trim()) return
    composing = true
    composeError = null
    try {
      const url = `/api/inbox/${encodeURIComponent(composeEmailId)}/${composeMode}`
      const body: Record<string, string> = { instruction: composeInstruction }
      if (composeMode === 'forward') body.to = composeTo.trim()
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        composeError = data.error ?? 'Failed to create draft'
      } else {
        composeMode = null
        const id = typeof data.id === 'string' ? data.id.trim() : ''
        if (id) navEmailDraft({ type: 'email-draft', id })
      }
    } catch (err) {
      composeError = String(err)
    }
    composing = false
  }

  onMount(() => {
    void load()
    const unsub = subscribe((e) => {
      if (e.type === 'sync:completed') {
        void load()
        return
      }
      if (e.type !== 'inbox:archived') return
      applyExternalArchive(e.messageId)
    })
    return unsub
  })

  /**
   * Open thread when URL / App hands us an id (chat preview, search, deep link).
   * Must not subscribe to `emails` — list refresh and markRead() replace the array and would
   * re-run the effect forever. Read list + thread state inside untrack().
   */
  $effect(() => {
    const id = (targetId ?? initialId)?.trim()
    if (!id) return
    untrack(() => {
      if (selectedThread === id && (threadContent || threadLoading)) return
      const email = emails.find(e => e.id === id)
      if (email) void openThread(email)
      else void openThreadByRawId(id)
    })
  })

  /** Measure which header values exceed 3 lines (line-clamp) so we can show Show more. */
  $effect(() => {
    if (!threadContent) return
    const rows = emailHeadersForDisplay(threadContent.headers)
    void selectedThread
    headerExpanded = {}
    headerOverflow = {}
    void tick().then(() => {
      requestAnimationFrame(() => {
        const next: Record<string, boolean> = {}
        for (const row of rows) {
          const el = headerValueRefs[row.key]
          if (!el) continue
          next[row.key] = el.scrollHeight > el.clientHeight
        }
        headerOverflow = next
      })
    })
  })

  const registerInboxThreadHeader = getContext<RegisterInboxThreadHeader | undefined>(
    INBOX_THREAD_HEADER,
  )

  /** Reply / Forward / Archive in SlideOver L2 header (icon-only). */
  $effect(() => {
    if (!registerInboxThreadHeader) return
    const showToolbar = Boolean(selectedThread && !composeMode)
    if (showToolbar) {
      registerInboxThreadHeader({
        onReply: () => startComposeFromThread('reply'),
        onForward: () => startComposeFromThread('forward'),
        onArchive: () => {
          const cur = selectedThread
          if (cur) void archive(cur)
        },
      })
    } else {
      registerInboxThreadHeader(null)
    }
    return () => registerInboxThreadHeader(null)
  })
</script>

<div class="inbox flex h-full min-h-0 flex-col">
  {#if !selectedThread}
    <header
      class="inbox-header flex shrink-0 items-center justify-between border-b border-border bg-surface-2 px-4 py-3"
    >
      <span class="title text-sm font-semibold">Inbox</span>
      <div class="header-actions flex items-center gap-2">
        {#if error}
          <span class="error-badge text-[11px] text-danger">{error}</span>
        {/if}
        {#if onSummarizeInbox}
          <button
            class="summarize-btn inline-flex items-center gap-1.5 border border-border bg-surface-3 px-2.5 py-1 text-[13px] text-foreground enabled:hover:border-accent-dim enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
            type="button"
            onclick={summarizeInbox}
            disabled={!!error || inboxListLoading}
            title="New chat: summarize all inbox items"
          >
            <Sparkles size={14} aria-hidden="true" />
            Summarize
          </button>
        {/if}
        <button
          class="sync-btn border border-accent-dim px-2.5 py-1 text-[13px] text-accent disabled:opacity-50"
          onclick={sync}
          disabled={syncing}
        >
          {syncing ? 'Syncing...' : 'Refresh'}
        </button>
      </div>
    </header>
  {/if}

  {#if selectedThread}
    <div class="thread-view relative flex min-h-0 flex-1 flex-col overflow-auto">
      {#if composeMode}
        <div
          class="compose-panel flex flex-1 flex-col gap-3 overflow-y-auto p-4"
        >
          <div
            class="compose-label text-xs font-semibold uppercase tracking-[0.05em] text-muted"
          >
            {composeMode === 'reply' ? 'Reply' : 'Forward'}
          </div>

          {#if composeMode === 'forward'}
            <div class="compose-field flex flex-col gap-1">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label class="field-label text-xs text-muted">To</label>
              <div class="to-wrap relative">
                <input
                  class="to-input w-full border border-border bg-surface-3 px-2.5 py-2 text-[13px] text-foreground focus:border-accent focus:outline-none"
                  type="text"
                  bind:value={composeTo}
                  placeholder="recipient@example.com"
                  autocomplete="off"
                />
                {#if filteredContacts.length > 0}
                  <ul
                    class="contact-suggestions absolute inset-x-0 top-full z-10 max-h-[200px] list-none overflow-y-auto border border-t-0 border-border bg-surface-2"
                  >
                    {#each filteredContacts as contact (contact.primaryAddress)}
                      <li>
                        <button
                          class="contact-option flex w-full items-baseline gap-2 px-2.5 py-2 text-left hover:bg-surface-3"
                          onmousedown={() => { composeTo = contact.primaryAddress }}
                        >
                          <span class="contact-name whitespace-nowrap text-[13px] text-foreground"
                            >{contact.firstname} {contact.lastname}</span
                          >
                          <span
                            class="contact-addr overflow-hidden whitespace-nowrap text-ellipsis text-[11px] text-muted"
                            >{contact.primaryAddress}</span
                          >
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </div>
          {/if}

          <textarea
            class="compose-textarea min-h-[100px] flex-1 resize-y border border-border bg-surface-3 p-2.5 text-[13px] leading-normal text-foreground [font-family:inherit] focus:border-accent focus:outline-none"
            bind:value={composeInstruction}
            placeholder={composeMode === 'reply'
              ? 'Brief instructions for the reply...'
              : 'Brief instructions for the forward...'}
            onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) createDraft() }}
          ></textarea>

          {#if composeError}
            <p class="compose-error text-xs text-danger">{composeError}</p>
          {/if}

          <div class="compose-footer flex justify-end gap-2">
            <button class="cancel-btn px-3 py-1.5 text-[13px] text-muted hover:text-foreground" onclick={cancelCompose}>Cancel</button>
            <button
              class="draft-btn border border-accent-dim px-3.5 py-1.5 text-[13px] text-accent disabled:cursor-default disabled:opacity-50"
              onclick={createDraft}
              disabled={composing || !composeInstruction.trim() || (composeMode === 'forward' && !composeTo.trim())}
            >
              {composing ? 'Drafting...' : 'Draft'}
            </button>
          </div>
        </div>

      {:else}
        <div
          class="thread-body flex-[0_0_auto] overflow-visible p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
        >
          {#if threadLoading}
            <p class="loading text-sm text-muted">Loading...</p>
          {:else if threadLoadError}
            <p class="thread-error m-0 text-sm leading-snug text-danger" role="alert">{threadLoadError}</p>
          {:else if threadContent}
            <div
              class="thread-meta mb-4 flex flex-col gap-1 rounded-lg bg-surface-2 px-4 py-3"
              aria-label="Message headers"
            >
              {#each emailHeadersForDisplay(threadContent.headers) as row (row.key)}
                <div
                  class="thread-meta-row grid grid-cols-[76px_minmax(0,1fr)] items-start gap-x-3.5 gap-y-1 text-[13px] leading-snug max-[480px]:grid-cols-1 max-[480px]:gap-y-[2px]"
                >
                  <span
                    class="thread-meta-label pt-px text-[11px] font-semibold uppercase tracking-[0.04em] text-muted max-[480px]:pt-0"
                    >{row.label}</span
                  >
                  <div
                    class="thread-meta-value-wrap flex min-w-0 flex-col items-start gap-1"
                  >
                    <span
                      use:headerValueRef={row.key}
                      class={cn(
                        'thread-meta-value text-foreground [word-break:break-word]',
                        !headerExpanded[row.key] &&
                          'thread-meta-value-clamped overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:3] [display:-webkit-box]',
                      )}
                      >{row.value}</span
                    >
                    {#if headerOverflow[row.key]}
                      <button
                        type="button"
                        class="thread-meta-toggle m-0 shrink-0 cursor-pointer border-none bg-none p-0 text-[11px] font-medium text-accent underline [font:inherit] [text-underline-offset:2px] hover:text-foreground"
                        aria-expanded={Boolean(headerExpanded[row.key])}
                        onclick={() => toggleHeaderRow(row.key)}
                      >
                        {headerExpanded[row.key] ? 'Show less' : 'Show more'}
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
            {#key selectedThread}
              <iframe
                class="thread-body-iframe block min-h-[80px] w-full overflow-hidden border-none bg-surface [color-scheme:light_dark]"
                title="Email message body"
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                srcdoc={threadIframeSrcdoc}
                use:iframeAutoHeight
              ></iframe>
            {/key}
          {:else}
            <p class="loading text-sm text-muted">Failed to load message.</p>
          {/if}
        </div>
      {/if}
    </div>

  {:else}
    <ul class="email-list flex-1 list-none overflow-y-auto">
      {#if inboxListLoading}
        <li class="list-loading px-8 py-12 text-center">
          <p class="loading m-0 text-sm text-muted">Loading…</p>
        </li>
      {:else}
        {#each emails as email (email.id)}
          <li
            class={cn(
              'email-item flex items-center border-b border-border',
              !email.read && 'unread [&_.from]:font-semibold [&_.from]:text-foreground [&_.subject]:font-semibold [&_.subject]:text-foreground',
            )}
          >
            <button
              class="email-body grid flex-1 grid-cols-[minmax(100px,180px)_1fr_auto] items-center gap-2 overflow-hidden px-4 py-3 text-left max-md:grid-cols-1 max-md:gap-[2px]"
              onclick={() => openThread(email)}
            >
              <span class="from overflow-hidden whitespace-nowrap text-ellipsis text-[13px] text-muted">{email.from}</span>
              <span class="subject overflow-hidden whitespace-nowrap text-ellipsis text-[13px] text-muted">{email.subject}</span>
              <span class="date whitespace-nowrap text-xs text-muted max-md:hidden">{formatDate(email.date)}</span>
            </button>
            <div class="email-actions flex shrink-0 items-center">
              <button
                class="action-icon-btn px-2 py-3 text-muted hover:text-foreground max-md:px-1.5 max-md:py-2.5"
                onclick={() => startCompose('reply', email)}
                title="Reply"
              >
                <Reply size={14} />
              </button>
              <button
                class="action-icon-btn px-2 py-3 text-muted hover:text-foreground max-md:px-1.5 max-md:py-2.5"
                onclick={() => startCompose('forward', email)}
                title="Forward"
              >
                <Forward size={14} />
              </button>
              <button
                class="archive-btn pb-3 pl-2 pr-4 pt-3 text-muted hover:text-foreground"
                onclick={() => archive(email.id)}
                title="Archive"
              >
                <Archive size={16} />
              </button>
            </div>
          </li>
        {:else}
          <li
            class="empty flex flex-col items-center gap-4 px-8 py-12 text-center text-sm text-muted"
          >
            {#if error}
              Inbox unavailable — ripmail may not be configured.
            {:else}
              <span class="empty-label text-muted">No messages</span>
              {#if onOpenSearch}
                <button
                  class="search-cta flex items-center gap-[7px] border border-accent-dim px-5 py-2.5 text-sm text-accent active:opacity-70"
                  onclick={onOpenSearch}
                >
                  <Search size={14} strokeWidth={2} aria-hidden="true" />
                  Search emails
                </button>
              {/if}
            {/if}
          </li>
        {/each}
      {/if}
    </ul>
  {/if}
</div>
