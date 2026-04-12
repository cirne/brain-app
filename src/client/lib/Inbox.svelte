<script lang="ts">
  type Email = {
    id: string
    from: string
    subject: string
    date: string
    read: boolean
  }

  let emails = $state<Email[]>([])
  let syncing = $state(false)

  async function load() {
    const res = await fetch('/api/inbox')
    emails = await res.json()
  }

  async function sync() {
    syncing = true
    await fetch('/api/inbox/sync', { method: 'POST' })
    await load()
    syncing = false
  }

  async function archive(id: string) {
    await fetch(`/api/inbox/${id}/archive`, { method: 'POST' })
    emails = emails.filter(e => e.id !== id)
  }

  async function markRead(id: string) {
    await fetch(`/api/inbox/${id}/read`, { method: 'POST' })
    emails = emails.map(e => e.id === id ? { ...e, read: true } : e)
  }

  $effect(() => { load() })
</script>

<div class="inbox">
  <header class="inbox-header">
    <span class="title">Inbox</span>
    <button class="sync-btn" onclick={sync} disabled={syncing}>
      {syncing ? 'Syncing…' : 'Refresh'}
    </button>
  </header>

  <ul class="email-list">
    {#each emails as email (email.id)}
      <li class="email-item" class:unread={!email.read}>
        <button class="email-body" onclick={() => markRead(email.id)}>
          <span class="from">{email.from}</span>
          <span class="subject">{email.subject}</span>
          <span class="date">{email.date}</span>
        </button>
        <button class="archive-btn" onclick={() => archive(email.id)} title="Archive">×</button>
      </li>
    {:else}
      <li class="empty">No messages</li>
    {/each}
  </ul>
</div>

<style>
  .inbox {
    display: flex;
    flex-direction: column;
    height: 100%;
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

  .title {
    font-weight: 600;
    font-size: 14px;
  }

  .sync-btn {
    font-size: 13px;
    color: var(--accent);
    padding: 4px 10px;
    border: 1px solid var(--accent-dim);
    border-radius: 4px;
  }

  .sync-btn:disabled {
    opacity: 0.5;
  }

  .email-list {
    list-style: none;
    overflow-y: auto;
    flex: 1;
  }

  .email-item {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }

  .email-item.unread .from,
  .email-item.unread .subject {
    font-weight: 600;
    color: var(--text);
  }

  .email-body {
    flex: 1;
    display: grid;
    grid-template-columns: 180px 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
    text-align: left;
    overflow: hidden;
  }

  .from {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-2);
  }

  .subject {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-2);
  }

  .date {
    font-size: 12px;
    color: var(--text-2);
    white-space: nowrap;
  }

  .archive-btn {
    padding: 12px 16px;
    color: var(--text-2);
    font-size: 18px;
    flex-shrink: 0;
  }

  .archive-btn:hover {
    color: var(--danger);
  }

  .empty {
    padding: 32px;
    text-align: center;
    color: var(--text-2);
    font-size: 14px;
  }
</style>
