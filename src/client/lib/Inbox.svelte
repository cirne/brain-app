<script lang="ts">
  import { Archive } from 'lucide-svelte'
  import { navigate } from '../router.js'

  type Email = {
    id: string
    from: string
    subject: string
    date: string
    read: boolean
  }

  let {
    initialId,
    onNavigate,
  }: {
    initialId?: string
    onNavigate?: (id: string | undefined) => void
  } = $props()

  let emails = $state<Email[]>([])
  let syncing = $state(false)
  let selectedThread = $state<string | null>(null)
  let threadContent = $state<{ headers: string; body: string } | null>(null)
  let threadLoading = $state(false)
  let error = $state<string | null>(null)

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

  async function archive(id: string) {
    await fetch(`/api/inbox/${id}/archive`, { method: 'POST' })
    emails = emails.filter(e => e.id !== id)
    if (selectedThread === id) { selectedThread = null; threadContent = '' }
  }

  async function markRead(id: string) {
    await fetch(`/api/inbox/${id}/read`, { method: 'POST' })
    emails = emails.map(e => e.id === id ? { ...e, read: true } : e)
  }

  async function openThread(email: Email) {
    selectedThread = email.id
    navigate({ tab: 'inbox', id: email.id })
    onNavigate?.(email.id)
    threadLoading = true
    await markRead(email.id)
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(email.id)}`)
      if (res.ok) {
        const text = await res.text()
        const blank = text.indexOf('\n\n')
        threadContent = blank === -1
          ? { headers: '', body: text }
          : { headers: text.slice(0, blank), body: text.slice(blank + 2) }
      }
    } catch { threadContent = null }
    threadLoading = false
  }

  function closeThread() {
    selectedThread = null
    threadContent = null
    navigate({ tab: 'inbox' })
    onNavigate?.(undefined)
  }

  $effect(() => {
    load().then(() => {
      if (initialId) {
        const email = emails.find(e => e.id === initialId)
        if (email) openThread(email)
      }
    })
  })
</script>

<div class="inbox">
  <header class="inbox-header">
    <span class="title">Inbox</span>
    <div class="header-actions">
      {#if error}
        <span class="error-badge">{error}</span>
      {/if}
      <button class="sync-btn" onclick={sync} disabled={syncing}>
        {syncing ? 'Syncing...' : 'Refresh'}
      </button>
    </div>
  </header>

  {#if selectedThread}
    <div class="thread-view">
      <div class="thread-header">
        <button class="back-btn" onclick={closeThread}>Back</button>
        <button class="archive-thread-btn" onclick={() => archive(selectedThread!)}>Archive</button>
      </div>
      <div class="thread-body">
        {#if threadLoading}
          <p class="loading">Loading...</p>
        {:else if threadContent}
          <pre class="thread-headers">{threadContent.headers}</pre>
          <pre class="thread-body-text">{threadContent.body}</pre>
        {:else}
          <p class="loading">Failed to load message.</p>
        {/if}
      </div>
    </div>
  {:else}
    <ul class="email-list">
      {#each emails as email (email.id)}
        <li class="email-item" class:unread={!email.read}>
          <button class="email-body" onclick={() => openThread(email)}>
            <span class="from">{email.from}</span>
            <span class="subject">{email.subject}</span>
            <span class="date">{email.date}</span>
          </button>
          <button class="archive-btn" onclick={() => archive(email.id)} title="Archive"><Archive size={16} /></button>
        </li>
      {:else}
        <li class="empty">
          {error ? 'Inbox unavailable - ripmail may not be configured.' : 'No messages'}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .inbox { display: flex; flex-direction: column; height: 100%; }

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

  .sync-btn {
    font-size: 13px; color: var(--accent);
    padding: 4px 10px; border: 1px solid var(--accent-dim); border-radius: 4px;
  }
  .sync-btn:disabled { opacity: 0.5; }

  .email-list { list-style: none; overflow-y: auto; flex: 1; }

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

  .archive-btn { padding: 12px 16px; color: var(--text-2); font-size: 18px; flex-shrink: 0; }
  .archive-btn:hover { color: var(--danger); }

  .empty { padding: 32px; text-align: center; color: var(--text-2); font-size: 14px; }

  .thread-view { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .thread-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px; border-bottom: 1px solid var(--border); background: var(--bg-2);
  }
  .back-btn { font-size: 13px; color: var(--accent); }
  .archive-thread-btn {
    font-size: 12px; color: var(--danger);
    padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px;
  }
  .thread-body { flex: 1; overflow-y: auto; padding: 16px; }
  .loading { color: var(--text-2); font-size: 14px; }
  .thread-headers {
    font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
    color: var(--text-2); border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 16px;
  }
  .thread-body-text { font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }

  @media (max-width: 768px) {
    .email-body { grid-template-columns: 1fr; gap: 2px; }
    .date { display: none; }
  }
</style>
