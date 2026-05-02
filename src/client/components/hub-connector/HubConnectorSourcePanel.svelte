<script lang="ts">
  import { untrack, getContext } from 'svelte'
  import { emit } from '@client/lib/app/appEvents.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  import {
    HUB_SOURCE_SLIDE_HEADER,
    type RegisterHubSourceSlideHeader,
  } from '@client/lib/hubSourceSlideHeaderContext.js'
  import {
    isMailSourceKind,
    type HubRipmailSourceRow,
    type HubMailStatusOk,
    type HubSourceDetailOk,
  } from '@client/lib/hub/hubRipmailSource.js'
  import HubConnectorIndexSections from './HubConnectorIndexSections.svelte'
  import HubConnectorMailSections from './HubConnectorMailSections.svelte'
  import HubConnectorSourceMeta from './HubConnectorSourceMeta.svelte'

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
  /** Per-source preferences: visibility (default-search) + default send. */
  let includedInDefault = $state<boolean | null>(null)
  let isDefaultSend = $state<boolean | null>(null)
  let prefsBusy = $state<'visibility' | 'default-send' | null>(null)
  let prefsError = $state<string | null>(null)
  let sourceDetail = $state<HubSourceDetailOk | null>(null)
  let _sourceDetailLoading = $state(false)
  let sourceDetailError = $state<string | null>(null)
  /** Hub kicked off `ripmail refresh` in background — disable refresh until stats move or timeout. */
  let indexRefreshPending = $state(false)
  let indexRefreshBaseline = $state<{
    docs: number
    cal: number
    last: string | null
  } | null>(null)
  let indexRefreshStartedAt = $state<number | null>(null)

  const hubSourceListLatest = createAsyncLatest({ abortPrevious: true })
  const hubSourceMailLatest = createAsyncLatest({ abortPrevious: true })
  const hubSourceDetailLatest = createAsyncLatest({ abortPrevious: true })

  const registerHubHeader = getContext<RegisterHubSourceSlideHeader | undefined>(HUB_SOURCE_SLIDE_HEADER)
  const showInlineRefresh = $derived(registerHubHeader === undefined)

  const INDEX_REFRESH_MAX_MS = 15 * 60 * 1000

  async function loadMailPrefs() {
    const id = sourceId?.trim()
    const row = source
    if (!id || !row || row.kind !== 'imap') return
    try {
      const res = await fetch('/api/hub/sources/mail-prefs')
      if (!res.ok) return
      const j = (await res.json()) as {
        ok?: boolean
        mailboxes?: { id: string; includeInDefault: boolean }[]
        defaultSendSource?: string | null
      }
      if (!j.ok || !Array.isArray(j.mailboxes)) return
      const mb = j.mailboxes.find((m) => m.id === id)
      includedInDefault = mb ? mb.includeInDefault : true
      isDefaultSend = j.defaultSendSource === id
    } catch {
      /* leave previous values */
    }
  }

  async function toggleIncludedInDefault() {
    const id = source?.id
    if (!id || prefsBusy) return
    const next = !(includedInDefault ?? true)
    prefsBusy = 'visibility'
    prefsError = null
    try {
      const res = await fetch('/api/hub/sources/include-in-default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, included: next }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        includeInDefault?: boolean
      }
      if (!res.ok || !j.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not update visibility')
      }
      includedInDefault = j.includeInDefault === true
      emit({ type: 'hub:sources-changed' })
    } catch (e) {
      prefsError = e instanceof Error ? e.message : 'Could not update visibility'
    } finally {
      prefsBusy = null
    }
  }

  async function setDefaultSend(makeDefault: boolean) {
    const id = source?.id
    if (!id || prefsBusy) return
    prefsBusy = 'default-send'
    prefsError = null
    try {
      const res = await fetch('/api/hub/sources/default-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: makeDefault ? id : '' }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        defaultSendSource?: string | null
      }
      if (!res.ok || !j.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not update default send mailbox')
      }
      isDefaultSend = j.defaultSendSource === id
      emit({ type: 'hub:sources-changed' })
    } catch (e) {
      prefsError = e instanceof Error ? e.message : 'Could not update default send mailbox'
    } finally {
      prefsBusy = null
    }
  }

  async function loadMailStatus() {
    const id = sourceId?.trim()
    if (!id) return
    const row = source
    if (!row || (row.kind !== 'imap' && row.kind !== 'applemail')) return
    const { token, signal } = hubSourceMailLatest.begin()
    mailStatusLoading = true
    mailStatusError = null
    try {
      const res = await fetch(`/api/hub/sources/mail-status?id=${encodeURIComponent(id)}`, { signal })
      if (hubSourceMailLatest.isStale(token)) return
      const j = (await res.json()) as HubMailStatusOk | { ok: false; error?: string }
      if (hubSourceMailLatest.isStale(token)) return
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
      if (hubSourceMailLatest.isStale(token) || isAbortError(e)) return
      mailStatusError = e instanceof Error ? e.message : 'Could not load status'
    } finally {
      if (!hubSourceMailLatest.isStale(token)) mailStatusLoading = false
    }
  }

  function maybeClearIndexRefreshPending(detail: HubSourceDetailOk) {
    if (!indexRefreshPending || indexRefreshStartedAt == null) return
    if (Date.now() - indexRefreshStartedAt > INDEX_REFRESH_MAX_MS) {
      indexRefreshPending = false
      indexRefreshBaseline = null
      indexRefreshStartedAt = null
      return
    }
    const b = indexRefreshBaseline
    const st = detail.status
    if (b == null) {
      if (st?.lastSyncedAt != null) {
        indexRefreshPending = false
        indexRefreshBaseline = null
        indexRefreshStartedAt = null
      }
      return
    }
    if (!st) return
    if (
      st.documentIndexRows !== b.docs ||
      st.calendarEventRows !== b.cal ||
      (st.lastSyncedAt ?? '') !== (b.last ?? '')
    ) {
      indexRefreshPending = false
      indexRefreshBaseline = null
      indexRefreshStartedAt = null
    }
  }

  /** JSON-stable view of detail fields that drive this panel; used to skip noop `sourceDetail` reassign. */
  function hubSourceDetailPanelSnapshot(d: HubSourceDetailOk | null): string | null {
    if (!d) return null
    return JSON.stringify({
      id: d.id,
      kind: d.kind,
      status: d.status,
      statusError: d.statusError ?? null,
      oauthSourceId: d.oauthSourceId,
      fileSource: d.fileSource,
      includeSharedWithMe: d.includeSharedWithMe,
      calendarIds: d.calendarIds,
      icsUrl: d.icsUrl,
    })
  }

  async function loadSourceDetail(opts?: { keepPreviousDetail?: boolean }) {
    const keep = opts?.keepPreviousDetail === true
    const id = sourceId?.trim()
    const row = source
    if (!id || !row || isMailSourceKind(row.kind)) return
    const { token, signal } = hubSourceDetailLatest.begin()
    if (!keep) {
      _sourceDetailLoading = true
      sourceDetailError = null
      sourceDetail = null
    }
    try {
      const res = await fetch(`/api/hub/sources/detail?id=${encodeURIComponent(id)}`, { signal })
      if (hubSourceDetailLatest.isStale(token)) return
      const j = (await res.json()) as HubSourceDetailOk | { ok: false; error?: string }
      if (hubSourceDetailLatest.isStale(token)) return
      if (!res.ok || !j.ok) {
        const err =
          typeof (j as { error?: string }).error === 'string'
            ? (j as { error: string }).error
            : 'Could not load source detail'
        sourceDetailError = err
        return
      }
      sourceDetailError = null
      const next = j as HubSourceDetailOk
      const prev = sourceDetail
      const detailSkippedNoop =
        prev != null && hubSourceDetailPanelSnapshot(prev) === hubSourceDetailPanelSnapshot(next)
      if (!detailSkippedNoop) {
        sourceDetail = next
      }
      maybeClearIndexRefreshPending(next)
    } catch (e) {
      if (hubSourceDetailLatest.isStale(token) || isAbortError(e)) return
      sourceDetailError = e instanceof Error ? e.message : 'Could not load source detail'
    } finally {
      const staleFinally = hubSourceDetailLatest.isStale(token)
      if (!staleFinally) {
        _sourceDetailLoading = false
      }
    }
  }

  async function load() {
    const sid = sourceId?.trim() ?? ''
    /** Avoid `$effect` re-running `load()` every time `source` is reassigned (same id, new object). */
    const keepExisting = untrack(
      () => sid.length > 0 && source !== null && source.id === sid,
    )
    /** Only invalidate in-flight detail when the panel resets; avoids abort+stale-finally fighting refresh polls. */
    if (!keepExisting) {
      hubSourceDetailLatest.begin()
    }
    hubSourceMailLatest.begin()
    const { token, signal } = hubSourceListLatest.begin()

    loadError = null
    if (!keepExisting) {
      source = null
      mailStatus = null
      mailStatusError = null
      mailStatusLoading = false
      includedInDefault = null
      isDefaultSend = null
      prefsError = null
      sourceDetail = null
      sourceDetailError = null
      _sourceDetailLoading = false
      indexRefreshPending = false
      indexRefreshBaseline = null
      indexRefreshStartedAt = null
    }
    if (!sourceId) {
      loadError = 'No source selected'
      return
    }
    try {
      const res = await fetch('/api/hub/sources', { signal })
      if (hubSourceListLatest.isStale(token)) return
      const j = (await res.json()) as { sources?: HubRipmailSourceRow[]; error?: string }
      if (hubSourceListLatest.isStale(token)) return
      if (!res.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Could not load sources')
      }
      const rows = Array.isArray(j.sources) ? j.sources : []
      const row = rows.find((r) => r.id === sourceId)
      if (!row) {
        loadError = 'This source is no longer in the index.'
        if (keepExisting) {
          source = null
          sourceDetail = null
        }
        return
      }
      source = row
      backfillWindow = '1y'
      if (!isMailSourceKind(row.kind)) {
        void loadSourceDetail({ keepPreviousDetail: keepExisting })
      }
      if (row.kind === 'imap' || row.kind === 'applemail') {
        void loadMailStatus()
      }
      if (row.kind === 'imap') {
        void loadMailPrefs()
      }
    } catch (e) {
      if (hubSourceListLatest.isStale(token) || isAbortError(e)) return
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
    if (driveSyncBlocked) return
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
      if (!isMailSourceKind(source.kind)) {
        indexRefreshPending = true
        indexRefreshStartedAt = Date.now()
        indexRefreshBaseline = sourceDetail?.status
          ? {
              docs: sourceDetail.status.documentIndexRows,
              cal: sourceDetail.status.calendarEventRows,
              last: sourceDetail.status.lastSyncedAt,
            }
          : null
      }
      if (isMailSourceKind(source.kind)) {
        await load()
      } else {
        void loadSourceDetail({ keepPreviousDetail: true })
      }
      await loadMailStatus()
    } catch (e) {
      indexRefreshPending = false
      indexRefreshBaseline = null
      indexRefreshStartedAt = null
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

  const driveSyncBlocked = $derived(
    source?.kind === 'googleDrive' &&
      sourceDetail != null &&
      (sourceDetail.fileSource == null || sourceDetail.fileSource.roots.length === 0),
  )

  $effect(() => {
    if (!registerHubHeader) return
    const src = source
    if (!src) {
      registerHubHeader(null)
      return
    }
    const mail = isMailSourceKind(src.kind)
    const blocked = !mail && driveSyncBlocked
    registerHubHeader({
      title: src.displayName,
      onRefresh: () => void hubSourceRefresh(),
      refreshDisabled: Boolean(sourceSyncAction) || blocked,
      refreshSpinning: Boolean(sourceSyncAction === 'refresh' || (!mail && indexRefreshPending)),
      refreshTitle: blocked
        ? 'Add at least one Drive folder in the list below before syncing'
        : undefined,
    })
    return () => registerHubHeader(null)
  })
</script>

<div class="hub-connector-source">
  {#if loadError}
    <p class="hub-connector-err" role="alert">{loadError}</p>
  {:else if source}
    <div class="hub-connector-inner">
      <HubConnectorSourceMeta {source} />
      {#if !isMailSourceKind(source.kind)}
        <HubConnectorIndexSections
          sourceDetailError={sourceDetailError}
          sourceDetail={sourceDetail}
          driveSyncBlocked={driveSyncBlocked}
          sourceSyncAction={sourceSyncAction}
          indexRefreshPending={indexRefreshPending}
          showInlineRefresh={showInlineRefresh}
          onRefresh={() => void hubSourceRefresh()}
          onReloadDetail={() => void loadSourceDetail({ keepPreviousDetail: false })}
        />
      {/if}
      {#if source.kind === 'imap' || source.kind === 'applemail'}
        <HubConnectorMailSections
          mailKind={source.kind}
          mailStatus={mailStatus}
          mailStatusLoading={mailStatusLoading}
          mailStatusError={mailStatusError}
          includedInDefault={includedInDefault}
          isDefaultSend={isDefaultSend}
          prefsBusy={prefsBusy}
          prefsError={prefsError}
          bind:backfillWindow
          sourceSyncAction={sourceSyncAction}
          showInlineRefresh={showInlineRefresh}
          onToggleIncludedInDefault={() => void toggleIncludedInDefault()}
          onSetDefaultSend={(checked) => void setDefaultSend(checked)}
          onRefresh={() => void hubSourceRefresh()}
          onBackfill={() => void hubSourceBackfill()}
        />
      {/if}
      <div class="hub-connector-footer">
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
    <p class="hub-connector-loading" role="status">Loading…</p>
  {/if}
</div>

<style>
  .hub-connector-source {
    padding: 1rem 1.25rem 1.5rem;
    min-height: 0;
    flex: 1;
    overflow: auto;
  }

  .hub-connector-loading,
  .hub-connector-err {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    line-height: 1.45;
  }

  .hub-connector-err {
    color: var(--danger);
  }

  .hub-connector-inner {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .hub-connector-source :global(.hub-source-meta-compact) {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .hub-connector-source :global(.hub-source-kind-line) {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-2);
    line-height: 1.35;
  }

  .hub-connector-source :global(.hub-source-path-line) {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-2);
    word-break: break-word;
  }

  .hub-connector-source :global(.hub-source-index-line) {
    margin: 0 0 0.25rem;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-2);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.45rem;
  }

  .hub-connector-source :global(.hub-source-index-line-sep) {
    opacity: 0.45;
    user-select: none;
    font-weight: 400;
  }

  .hub-connector-source :global(.hub-drive-pref-line) {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-2);
  }

  .hub-connector-source :global(.hub-drive-pref-val) {
    font-weight: 600;
    color: var(--text);
  }

  .hub-connector-source :global(.hub-ics-line) {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--text-2);
  }

  .hub-connector-source :global(.hub-ics-label) {
    font-weight: 600;
    color: var(--text-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.6875rem;
  }

  .hub-connector-source :global(.hub-ics-url) {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.78rem;
    word-break: break-all;
    color: var(--text);
  }

  .hub-connector-source :global(.hub-source-sync-buttons--inline) {
    margin-top: 0.35rem;
  }

  .hub-connector-source :global(.hub-source-status-section) {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem 0 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .hub-connector-source :global(.hub-source-prefs-section) {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.85rem 0 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .hub-connector-source :global(.hub-source-pref-row) {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.45rem 0;
    cursor: pointer;
  }

  .hub-connector-source :global(.hub-source-pref-row input[type='checkbox']) {
    margin-top: 0.2rem;
    flex-shrink: 0;
    accent-color: var(--accent);
  }

  .hub-connector-source :global(.hub-source-pref-text) {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .hub-connector-source :global(.hub-source-pref-title) {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
  }

  .hub-connector-source :global(.hub-source-pref-sub) {
    font-size: 0.8125rem;
    color: var(--text-2);
    line-height: 1.4;
  }

  .hub-connector-source :global(.hub-source-status-heading) {
    margin: 0;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
  }

  .hub-connector-source :global(.hub-source-status-note) {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-2);
  }

  .hub-connector-source :global(.hub-source-status-note--active) {
    color: var(--accent);
    font-weight: 600;
  }

  :global(.hub-refresh-working) {
    animation: hub-refresh-spin 0.85s linear infinite;
  }

  @keyframes hub-refresh-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .hub-connector-source :global(.hub-source-status-err) {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger);
    line-height: 1.45;
  }

  .hub-connector-source :global(.hub-source-status-warn) {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text);
    background: var(--bg-2);
    border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
    padding: 0.5rem 0.65rem;
}

  .hub-connector-source :global(.hub-source-code) {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.8em;
  }

  .hub-connector-source :global(.hub-source-id) {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.8125rem;
    color: var(--text-2);
  }

  .hub-connector-source :global(.hub-source-path) {
    font-size: 0.8125rem;
    line-height: 1.35;
  }

  .hub-connector-source :global(.hub-source-mail-sync) {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.85rem 0 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .hub-connector-source :global(.hub-source-sync-lead) {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.45;
    color: var(--text-2);
  }

  .hub-connector-source :global(.hub-source-sync-controls) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
  }

  .hub-connector-source :global(.hub-backfill-label) {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-2);
  }

  .hub-connector-source :global(.hub-backfill-select) {
    font-size: 0.875rem;
    padding: 0.35rem 0.6rem;
border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
    background: var(--bg);
    color: var(--text);
    min-width: 9rem;
    cursor: pointer;
  }

  .hub-connector-source :global(.hub-source-sync-buttons) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .hub-connector-source :global(.hub-source-sync-btn) {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .hub-connector-footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
    padding-top: 1rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .hub-connector-source :global(.hub-dialog-btn) {
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.45rem 0.9rem;
cursor: pointer;
    border: 1px solid transparent;
    transition:
      background 0.15s,
      color 0.15s,
      border-color 0.15s;
  }

  .hub-connector-source :global(.hub-dialog-btn:disabled) {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .hub-connector-source :global(.hub-dialog-btn-secondary) {
    background: transparent;
    color: var(--text);
    border-color: color-mix(in srgb, var(--border) 80%, transparent);
  }

  .hub-connector-source :global(.hub-dialog-btn-secondary:hover:not(:disabled)) {
    background: var(--bg-2);
  }

  .hub-connector-source :global(.hub-dialog-btn-danger) {
    background: color-mix(in srgb, var(--danger) 14%, var(--bg));
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  }

  .hub-connector-source :global(.hub-dialog-btn-danger:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--danger) 24%, var(--bg));
  }

  .hub-connector-source :global(.hub-dialog-btn-primary) {
    background: var(--accent);
    color: white;
    border-color: color-mix(in srgb, var(--accent) 80%, black);
  }

  .hub-connector-source :global(.hub-dialog-btn-primary:hover:not(:disabled)) {
    filter: brightness(1.06);
  }
</style>
