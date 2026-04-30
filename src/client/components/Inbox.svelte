<script lang="ts">
  import { getContext, onMount, tick, untrack } from 'svelte'
  import { Archive, Forward, Reply, Search, Sparkles } from 'lucide-svelte'
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
  /** When opening by id that is not in the inbox list (e.g. agent read_email id). */
  let orphanThreadMeta = $state<{ subject: string; from: string } | null>(null)
  let error = $state<string | null>(null)

  // Compose state
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

  // Contact autocomplete
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
      'Summarize my current inbox. For each thread give a one-line summary; then overall themes and anything urgent or actionable. Use read_email with the message ids below to read bodies when needed (or search_index).'
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
        // Update context with body now that it's loaded (cap at 4000 chars)
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

<div class="inbox">
  {#if !selectedThread}
    <header class="inbox-header">
      <span class="title">Inbox</span>
      <div class="header-actions">
        {#if error}
          <span class="error-badge">{error}</span>
        {/if}
        {#if onSummarizeInbox}
          <button
            class="summarize-btn"
            type="button"
            onclick={summarizeInbox}
            disabled={!!error || inboxListLoading}
            title="New chat: summarize all inbox items"
          >
            <Sparkles size={14} aria-hidden="true" />
            Summarize
          </button>
        {/if}
        <button class="sync-btn" onclick={sync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Refresh'}
        </button>
      </div>
    </header>
  {/if}

  {#if selectedThread}
    <div class="thread-view">
      {#if composeMode}
        <div class="compose-panel">
          <div class="compose-label">{composeMode === 'reply' ? 'Reply' : 'Forward'}</div>

          {#if composeMode === 'forward'}
            <div class="compose-field">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label class="field-label">To</label>
              <div class="to-wrap">
                <input
                  class="to-input"
                  type="text"
                  bind:value={composeTo}
                  placeholder="recipient@example.com"
                  autocomplete="off"
                />
                {#if filteredContacts.length > 0}
                  <ul class="contact-suggestions">
                    {#each filteredContacts as contact}
                      <li>
                        <button
                          class="contact-option"
                          onmousedown={() => { composeTo = contact.primaryAddress }}
                        >
                          <span class="contact-name">{contact.firstname} {contact.lastname}</span>
                          <span class="contact-addr">{contact.primaryAddress}</span>
                        </button>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </div>
          {/if}

          <textarea
            class="compose-textarea"
            bind:value={composeInstruction}
            placeholder={composeMode === 'reply'
              ? 'Brief instructions for the reply...'
              : 'Brief instructions for the forward...'}
            onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) createDraft() }}
          ></textarea>

          {#if composeError}
            <p class="compose-error">{composeError}</p>
          {/if}

          <div class="compose-footer">
            <button class="cancel-btn" onclick={cancelCompose}>Cancel</button>
            <button
              class="draft-btn"
              onclick={createDraft}
              disabled={composing || !composeInstruction.trim() || (composeMode === 'forward' && !composeTo.trim())}
            >
              {composing ? 'Drafting...' : 'Draft'}
            </button>
          </div>
        </div>

      {:else}
        <div class="thread-body">
          {#if threadLoading}
            <p class="loading">Loading...</p>
          {:else if threadLoadError}
            <p class="thread-error" role="alert">{threadLoadError}</p>
          {:else if threadContent}
            <div class="thread-meta" aria-label="Message headers">
              {#each emailHeadersForDisplay(threadContent.headers) as row (row.key)}
                <div class="thread-meta-row">
                  <span class="thread-meta-label">{row.label}</span>
                  <div class="thread-meta-value-wrap">
                    <span
                      use:headerValueRef={row.key}
                      class="thread-meta-value"
                      class:thread-meta-value-clamped={!headerExpanded[row.key]}
                    >{row.value}</span>
                    {#if headerOverflow[row.key]}
                      <button
                        type="button"
                        class="thread-meta-toggle"
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
                class="thread-body-iframe"
                title="Email message body"
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                srcdoc={threadIframeSrcdoc}
                use:iframeAutoHeight
              ></iframe>
            {/key}
          {:else}
            <p class="loading">Failed to load message.</p>
          {/if}
        </div>
      {/if}
    </div>

  {:else}
    <ul class="email-list">
      {#if inboxListLoading}
        <li class="list-loading">
          <p class="loading">Loading…</p>
        </li>
      {:else}
        {#each emails as email (email.id)}
          <li class="email-item" class:unread={!email.read}>
            <button class="email-body" onclick={() => openThread(email)}>
              <span class="from">{email.from}</span>
              <span class="subject">{email.subject}</span>
              <span class="date">{formatDate(email.date)}</span>
            </button>
            <div class="email-actions">
              <button class="action-icon-btn" onclick={() => startCompose('reply', email)} title="Reply">
                <Reply size={14} />
              </button>
              <button class="action-icon-btn" onclick={() => startCompose('forward', email)} title="Forward">
                <Forward size={14} />
              </button>
              <button class="archive-btn" onclick={() => archive(email.id)} title="Archive">
                <Archive size={16} />
              </button>
            </div>
          </li>
        {:else}
          <li class="empty">
            {#if error}
              Inbox unavailable — ripmail may not be configured.
            {:else}
              <span class="empty-label">No messages</span>
              {#if onOpenSearch}
                <button class="search-cta" onclick={onOpenSearch}>
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

<style>
  .inbox {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .inbox-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-2);
    flex-shrink: 0;
  }
  .title { font-weight: 600; font-size: 14px; }
  .header-actions { display: flex; align-items: center; gap: 8px; }
  .error-badge { font-size: 11px; color: var(--danger); }

  .summarize-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text);
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-3);
  }
  .summarize-btn:hover:not(:disabled) {
    border-color: var(--accent-dim);
    color: var(--accent);
  }
  .summarize-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .sync-btn {
    font-size: 13px; color: var(--accent);
    padding: 4px 10px; border: 1px solid var(--accent-dim); border-radius: 4px;
  }
  .sync-btn:disabled { opacity: 0.5; }

  /* Email list */
  .email-list { list-style: none; overflow-y: auto; flex: 1; }

  .list-loading {
    padding: 48px 32px;
    text-align: center;
  }
  .list-loading .loading { margin: 0; }

  .email-item { display: flex; align-items: center; border-bottom: 1px solid var(--border); }
  .email-item.unread .from, .email-item.unread .subject { font-weight: 600; color: var(--text); }

  .email-body {
    flex: 1; display: grid;
    grid-template-columns: minmax(100px, 180px) 1fr auto;
    gap: 8px; align-items: center;
    padding: 12px 16px; text-align: left; overflow: hidden;
  }

  .from, .subject {
    font-size: 13px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; color: var(--text-2);
  }
  .date { font-size: 12px; color: var(--text-2); white-space: nowrap; }

  .email-actions { display: flex; align-items: center; flex-shrink: 0; }
  .action-icon-btn { padding: 12px 8px; color: var(--text-2); }
  .action-icon-btn:hover { color: var(--text); }
  .archive-btn { padding: 12px 16px 12px 8px; color: var(--text-2); }
  .archive-btn:hover { color: var(--text); }

  .empty {
    padding: 48px 32px;
    text-align: center;
    color: var(--text-2);
    font-size: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .empty-label { color: var(--text-2); }
  .search-cta {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 14px;
    color: var(--accent);
    padding: 10px 20px;
    border: 1px solid var(--accent-dim);
    border-radius: 8px;
  }
  .search-cta:active { opacity: 0.7; }

  /* Thread view */
  .thread-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: auto;
    position: relative;
    min-height: 0;
  }

  .thread-body {
    flex: 0 0 auto;
    overflow: visible;
    padding: 16px;
    padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  }
  .loading { color: var(--text-2); font-size: 14px; }
  .thread-error {
    color: var(--danger);
    font-size: 14px;
    line-height: 1.45;
    margin: 0;
  }
  .thread-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-bottom: 16px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }
  .thread-meta-row {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    gap: 4px 14px;
    align-items: start;
    font-size: 13px;
    line-height: 1.35;
  }
  .thread-meta-label {
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-2);
    padding-top: 1px;
  }
  .thread-meta-value-wrap {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .thread-meta-value {
    color: var(--text);
    word-break: break-word;
  }
  .thread-meta-value-clamped {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
  }
  .thread-meta-toggle {
    flex-shrink: 0;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .thread-meta-toggle:hover {
    color: var(--text);
  }
  @media (max-width: 480px) {
    .thread-meta-row {
      grid-template-columns: 1fr;
      gap: 2px;
    }
    .thread-meta-label {
      padding-top: 0;
    }
  }
  .thread-body-iframe {
    display: block;
    width: 100%;
    min-height: 80px;
    border: none;
    border-radius: 4px;
    background: var(--bg);
    color-scheme: light dark;
    overflow: hidden;
  }

  /* Compose panel */
  .compose-panel {
    flex: 1; display: flex; flex-direction: column; gap: 12px;
    padding: 16px; overflow-y: auto;
  }
  .compose-label { font-size: 12px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.05em; }

  .compose-field { display: flex; flex-direction: column; gap: 4px; }
  .field-label { font-size: 12px; color: var(--text-2); }
  .to-wrap { position: relative; }
  .to-input {
    width: 100%; padding: 8px 10px; font-size: 13px;
    background: var(--bg-3); border: 1px solid var(--border); border-radius: 4px; color: var(--text);
  }
  .to-input:focus { outline: none; border-color: var(--accent); }

  .contact-suggestions {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
    background: var(--bg-2); border: 1px solid var(--border); border-top: none;
    border-radius: 0 0 4px 4px; list-style: none; max-height: 200px; overflow-y: auto;
  }
  .contact-option {
    width: 100%; padding: 8px 10px; text-align: left;
    display: flex; align-items: baseline; gap: 8px;
  }
  .contact-option:hover { background: var(--bg-3); }
  .contact-name { font-size: 13px; color: var(--text); white-space: nowrap; }
  .contact-addr { font-size: 11px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .compose-textarea {
    flex: 1; min-height: 100px; padding: 10px; font-size: 13px; line-height: 1.5;
    background: var(--bg-3); border: 1px solid var(--border); border-radius: 4px;
    color: var(--text); resize: vertical; font-family: inherit;
  }
  .compose-textarea:focus { outline: none; border-color: var(--accent); }

  .compose-error { font-size: 12px; color: var(--danger); }

  .compose-footer { display: flex; justify-content: flex-end; gap: 8px; }
  .cancel-btn { font-size: 13px; color: var(--text-2); padding: 6px 12px; }
  .cancel-btn:hover { color: var(--text); }
  .draft-btn {
    font-size: 13px; color: var(--accent);
    padding: 6px 14px; border: 1px solid var(--accent-dim); border-radius: 4px;
  }
  .draft-btn:disabled { opacity: 0.5; cursor: default; }

  @media (max-width: 768px) {
    .email-body { grid-template-columns: 1fr; gap: 2px; }
    .date { display: none; }
    .action-icon-btn { padding: 10px 6px; }
  }
</style>
