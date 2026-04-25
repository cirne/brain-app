<script lang="ts">
  import { History, RefreshCw } from 'lucide-svelte'
  import { emit } from '@client/lib/app/appEvents.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'

  type HubRipmailSourceRow = {
    id: string
    kind: string
    displayName: string
    path: string | null
  }

  type HubMailStatusMailbox = {
    messageCount: number
    earliestDate: string | null
    latestDate: string | null
    newestIndexedAgo: string | null
    needsBackfill: boolean
    lastUid: number | null
  }

  type HubMailStatusIndex = {
    totalIndexed: number | null
    syncRunning: boolean
    staleLockInDb: boolean
    refreshRunning: boolean
    backfillRunning: boolean
    lastSyncAt: string | null
    lastSyncAgoHuman: string | null
  }

  type HubMailStatusOk = {
    ok: true
    sourceId: string
    mailbox: HubMailStatusMailbox | null
    index: HubMailStatusIndex
  }

  type Props = {
    sourceId: string | undefined
    onClose: () => void
  }

  let { sourceId, onClose }: Props = $props()

  let source = $state<HubRipmailSourceRow | null>(null)
  let loadError = $state<string | null>(null)
  let removingSource = $state(false)
  let sourceSyncAction = $state<'refresh' | 'backfill' | null>(null)
  let backfillWindow = $state('1y')
  let mailStatus = $state<HubMailStatusOk | null>(null)
  let mailStatusLoading = $state(false)
  let mailStatusError = $state<string | null>(null)

  const hubSourceLatest = createAsyncLatest({ abortPrevious: true })

  const BACKFILL_WINDOW_OPTIONS = [
    { value: '30d', label: '30 days' },
    { value: '90d', label: '90 days' },
    { value: '180d', label: '180 days' },
    { value: '1y', label: '1 year' },
    { value: '2y', label: '2 years' },
  ] as const

  function formatDay(iso: string | null): string {
    if (!iso?.trim()) return '—'
    const t = iso.trim()
    return t.length >= 10 ? t.slice(0, 10) : t
  }

  function formatLastSync(idx: HubMailStatusIndex): string {
    if (idx.lastSyncAgoHuman?.trim()) return idx.lastSyncAgoHuman.trim()
    return formatDay(idx.lastSyncAt)
  }

  function sourceKindLabel(kind: string): string {
    switch (kind) {
      case 'imap':
        return 'Email (IMAP)'
      case 'applemail':
        return 'Apple Mail'
      case 'localDir':
        return 'Local folder'
      case 'googleCalendar':
        return 'Google Calendar'
      case 'appleCalendar':
        return 'Apple Calendar'
      case 'icsSubscription':
        return 'Subscribed calendar'
      case 'icsFile':
        return 'Calendar file'
      default:
        return kind
    }
  }

  async function loadMailStatus() {
    const id = sourceId?.trim()
    if (!id) return
    const row = source
    if (!row || (row.kind !== 'imap' && row.kind !== 'applemail')) return
    const { token, signal } = hubSourceLatest.begin()
    mailStatusLoading = true
    mailStatusError = null
    try {
      const res = await fetch(`/api/hub/sources/mail-status?id=${encodeURIComponent(id)}`, { signal })
      if (hubSourceLatest.isStale(token)) return
      const j = (await res.json()) as HubMailStatusOk | { ok: false; error?: string }
      if (hubSourceLatest.isStale(token)) return
      if (!j.ok) {
        mailStatusError =
          typeof (j as { error?: string }).error === 'string'
            ? (j as { error: string }).error
            : 'Could not load status'
        return
      }
      mailStatusError = null
      mailStatus = j
    } catch (e) {
      if (hubSourceLatest.isStale(token) || isAbortError(e)) return
      mailStatusError = e instanceof Error ? e.message : 'Could not load status'
    } finally {
      if (!hubSourceLatest.isStale(token)) mailStatusLoading = false
    }
  }

  async function load() {
    const { token, signal } = hubSourceLatest.begin()
    loadError = null
    source = null
    mailStatus = null
    mailStatusError = null
    mailStatusLoading = false
    if (!sourceId) {
      loadError = 'No source selected'
      return
    }
    try {
      const res = await fetch('/api/hub/sources', { signal })
      if (hubSourceLatest.isStale(token)) return
      const j = (await res.json()) as { sources?: HubRipmailSourceRow[]; error?: string }
      if (hubSourceLatest.isStale(token)) return
      if (!res.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not load sources')
      }
      const rows = Array.isArray(j.sources) ? j.sources : []
      const row = rows.find((r) => r.id === sourceId)
      if (!row) {
        loadError = 'This source is no longer in the index.'
        return
      }
      source = row
      backfillWindow = '1y'
      if (row.kind === 'imap' || row.kind === 'applemail') {
        void loadMailStatus()
      }
    } catch (e) {
      if (hubSourceLatest.isStale(token) || isAbortError(e)) return
      loadError = e instanceof Error ? e.message : 'Could not load source'
    }
  }

  async function confirmRemoveSource() {
    if (!source) return
    const name = source.displayName
    if (
      !confirm(
        `Remove “${name}” from the search index?\n\nNothing is deleted on disk. Braintunnel will stop searching this source.`,
      )
    ) {
      return
    }
    removingSource = true
    try {
      const res = await fetch('/api/hub/sources/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: source.id }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not remove source')
      }
      emit({ type: 'hub:sources-changed' })
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not remove source')
    } finally {
      removingSource = false
    }
  }

  async function hubSourceRefresh() {
    if (!source) return
    if (sourceSyncAction) return
    sourceSyncAction = 'refresh'
    try {
      const res = await fetch('/api/hub/sources/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: source.id }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not start refresh')
      }
      await load()
      await loadMailStatus()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not start refresh')
    } finally {
      sourceSyncAction = null
    }
  }

  async function hubSourceBackfill() {
    if (!source) return
    if (sourceSyncAction) return
    sourceSyncAction = 'backfill'
    try {
      const res = await fetch('/api/hub/sources/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: source.id, since: backfillWindow }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not start backfill')
      }
      await load()
      await loadMailStatus()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not start backfill')
    } finally {
      sourceSyncAction = null
    }
  }

  $effect(() => {
    sourceId
    void load()
  })

  $effect(() => {
    if (!sourceId?.trim()) return
    if (!source || (source.kind !== 'imap' && source.kind !== 'applemail')) return
    const t = window.setInterval(() => void loadMailStatus(), 6000)
    return () => window.clearInterval(t)
  })
</script>

<div class="hub-source-inspect">
  {#if loadError}
    <p class="hub-source-inspect-err" role="alert">{loadError}</p>
  {:else if source}
    <div class="hub-source-inspect-inner">
      <h3 class="hub-source-inspect-title">{source.displayName}</h3>
      <dl class="hub-source-meta">
        <div class="hub-source-meta-row">
          <dt>Type</dt>
          <dd>{sourceKindLabel(source.kind)}</dd>
        </div>
        <div class="hub-source-meta-row">
          <dt>Source id</dt>
          <dd class="hub-source-id">{source.id}</dd>
        </div>
        {#if source.path}
          <div class="hub-source-meta-row">
            <dt>Path</dt>
            <dd class="hub-source-path">{source.path}</dd>
          </div>
        {/if}
      </dl>
      {#if source.kind === 'imap' || source.kind === 'applemail'}
        <section class="hub-source-status-section" aria-labelledby="hub-mail-status-heading">
          <h2 id="hub-mail-status-heading" class="hub-source-status-heading">Index status</h2>
          {#if mailStatusLoading && !mailStatus}
            <p class="hub-source-status-note" role="status">Loading status…</p>
          {:else if mailStatusError}
            <p class="hub-source-status-err" role="alert">{mailStatusError}</p>
          {:else if mailStatus}
            {#if mailStatus.index.staleLockInDb}
              <p class="hub-source-status-warn" role="alert">
                A previous sync stopped unexpectedly. Quit Braintunnel completely and reopen to clear the stale lock.
              </p>
            {/if}
            {#if mailStatus.index.refreshRunning || mailStatus.index.backfillRunning}
              <p class="hub-source-status-note hub-source-status-note--active" role="status">
                {#if mailStatus.index.refreshRunning && mailStatus.index.backfillRunning}
                  Refresh and backfill are running…
                {:else if mailStatus.index.backfillRunning}
                  Backfill is running…
                {:else}
                  Refresh is running…
                {/if}
              </p>
            {/if}
            {#if mailStatus.mailbox?.needsBackfill}
              <p class="hub-source-status-warn">
                This account is configured but has no indexed mail yet. Run backfill (or refresh) to pull history.
              </p>
            {/if}
            {#if mailStatus.mailbox}
              {@const mb = mailStatus.mailbox}
              {@const idx = mailStatus.index}
              <dl class="hub-source-meta hub-source-meta--dense">
                <div class="hub-source-meta-row">
                  <dt>Messages (this source)</dt>
                  <dd>{mb.messageCount.toLocaleString()}</dd>
                </div>
                <div class="hub-source-meta-row">
                  <dt>Indexed date range</dt>
                  <dd>
                    {formatDay(mb.earliestDate)} — {formatDay(mb.latestDate)}
                  </dd>
                </div>
                <div class="hub-source-meta-row">
                  <dt>Newest indexed mail</dt>
                  <dd>{mb.newestIndexedAgo?.trim() || '—'}</dd>
                </div>
                <div class="hub-source-meta-row">
                  <dt>Last sync</dt>
                  <dd>{formatLastSync(idx)}</dd>
                </div>
                {#if mb.lastUid != null}
                  <div class="hub-source-meta-row">
                    <dt>Last UID</dt>
                    <dd>{mb.lastUid}</dd>
                  </div>
                {/if}
                {#if idx.totalIndexed != null}
                  <div class="hub-source-meta-row">
                    <dt>All sources (search index)</dt>
                    <dd>{idx.totalIndexed.toLocaleString()} messages</dd>
                  </div>
                {/if}
              </dl>
            {:else}
              <p class="hub-source-status-note">
                No mailbox row in <code class="hub-source-code">ripmail status</code> for this source id yet. After the
                first successful sync, counts and dates will appear here.
              </p>
            {/if}
          {/if}
        </section>
        <div class="hub-source-mail-sync">
          <p class="hub-source-sync-lead">
            Refresh pulls new mail for this account. Backfill re-downloads history for the window below
            (long-running).
          </p>
          <div class="hub-source-sync-controls">
            <label class="hub-backfill-label" for="hub-panel-backfill-since">Backfill window</label>
            <select id="hub-panel-backfill-since" class="hub-backfill-select" bind:value={backfillWindow}>
              {#each BACKFILL_WINDOW_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </div>
          <div class="hub-source-sync-buttons">
            <button
              type="button"
              class="hub-dialog-btn hub-dialog-btn-primary hub-source-sync-btn"
              disabled={sourceSyncAction !== null}
              onclick={() => void hubSourceRefresh()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {sourceSyncAction === 'refresh' ? 'Starting…' : 'Refresh'}
            </button>
            <button
              type="button"
              class="hub-dialog-btn hub-dialog-btn-secondary hub-source-sync-btn"
              disabled={sourceSyncAction !== null}
              onclick={() => void hubSourceBackfill()}
            >
              <History size={16} aria-hidden="true" />
              {sourceSyncAction === 'backfill' ? 'Starting…' : 'Retry sync (backfill)'}
            </button>
          </div>
        </div>
      {/if}
      <div class="hub-source-inspect-footer">
        <button
          type="button"
          class="hub-dialog-btn hub-dialog-btn-danger"
          disabled={removingSource}
          onclick={() => void confirmRemoveSource()}
        >
          {removingSource ? 'Removing…' : 'Remove from index'}
        </button>
      </div>
    </div>
  {:else}
    <p class="hub-source-inspect-loading" role="status">Loading…</p>
  {/if}
</div>

<style>
  .hub-source-inspect {
    padding: 1rem 1.25rem 1.5rem;
    min-height: 0;
    flex: 1;
    overflow: auto;
  }

  .hub-source-inspect-loading,
  .hub-source-inspect-err {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    line-height: 1.45;
  }

  .hub-source-inspect-err {
    color: var(--danger);
  }

  .hub-source-inspect-inner {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .hub-source-inspect-title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.25;
  }

  .hub-source-meta {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .hub-source-meta-row {
    display: grid;
    grid-template-columns: 6.5rem 1fr;
    gap: 0.5rem 1rem;
    font-size: 0.875rem;
    align-items: baseline;
  }

  .hub-source-meta-row dt {
    margin: 0;
    font-weight: 600;
    color: var(--text-2);
  }

  .hub-source-meta-row dd {
    margin: 0;
    word-break: break-word;
  }

  .hub-source-meta--dense {
    gap: 0.5rem;
  }

  .hub-source-status-section {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem 0 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .hub-source-status-heading {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
  }

  .hub-source-status-note {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-2);
  }

  .hub-source-status-note--active {
    color: var(--accent);
    font-weight: 600;
  }

  .hub-source-status-err {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger);
    line-height: 1.45;
  }

  .hub-source-status-warn {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text);
    background: var(--bg-2);
    border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
    padding: 0.5rem 0.65rem;
    border-radius: 8px;
  }

  .hub-source-code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.8em;
  }

  .hub-source-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
      monospace;
    font-size: 0.8125rem;
    color: var(--text-2);
  }

  .hub-source-path {
    font-size: 0.8125rem;
    line-height: 1.35;
  }

  .hub-source-mail-sync {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.85rem 0 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .hub-source-sync-lead {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-2);
  }

  .hub-source-sync-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .hub-backfill-label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-2);
  }

  .hub-backfill-select {
    font-size: 0.875rem;
    padding: 0.35rem 0.6rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    background: var(--bg);
    color: var(--text);
    min-width: 9rem;
    cursor: pointer;
  }

  .hub-source-sync-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .hub-source-sync-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .hub-source-inspect-footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
    padding-top: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .hub-dialog-btn {
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.45rem 0.9rem;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .hub-dialog-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .hub-dialog-btn-secondary {
    background: transparent;
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 80%, transparent);
  }

  .hub-dialog-btn-secondary:hover:not(:disabled) {
    background: var(--bg-2);
  }

  .hub-dialog-btn-danger {
    background: color-mix(in srgb, var(--danger) 14%, var(--bg));
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }

  .hub-dialog-btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 24%, var(--bg));
  }

  .hub-dialog-btn-primary {
    background: var(--accent);
    color: white;
    border-color: color-mix(in srgb, var(--accent) 80%, black);
  }

  .hub-dialog-btn-primary:hover:not(:disabled) {
    filter: brightness(1.06);
  }
</style>
