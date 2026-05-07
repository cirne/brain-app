<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { cn } from '@client/lib/cn.js'
  import { emit } from '@client/lib/app/appEvents.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  import { getHubSourceSlideHeaderCell } from '@client/lib/hubSourceSlideHeaderContext.js'
  import {
    isMailSourceKind,
    type HubRipmailSourceRow,
    type HubMailStatusOk,
    type HubSourceDetailOk,
  } from '@client/lib/hub/hubRipmailSource.js'
  import HubConnectorIndexSections from '@components/hub-connector/HubConnectorIndexSections.svelte'
  import HubConnectorMailSections from '@components/hub-connector/HubConnectorMailSections.svelte'
  import HubConnectorSourceMeta from '@components/hub-connector/HubConnectorSourceMeta.svelte'

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

  const hubSourceHeaderCell = getHubSourceSlideHeaderCell()
  const showInlineRefresh = $derived(hubSourceHeaderCell === undefined)

  /** Stable refresh handler — function declarations are hoisted; identity is constant. */
  function hubSourceHeaderRefresh() {
    void hubSourceRefresh()
  }

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

  /**
   * Hub source header is only visible once the source row has loaded. We claim/release the
   * cell as `source` flips between null and present, with a stable `onRefresh` handler.
   * Reactive scalars (title, busy/disabled) flow via `patch`. See BUG-047.
   */
  let hubSourceHeaderCtrl:
    | ReturnType<NonNullable<typeof hubSourceHeaderCell>['claim']>
    | null = null

  $effect(() => {
    if (!hubSourceHeaderCell) return
    const src = source
    if (!src) {
      if (hubSourceHeaderCtrl) {
        hubSourceHeaderCtrl.clear()
        hubSourceHeaderCtrl = null
      }
      return
    }
    const mail = isMailSourceKind(src.kind)
    const blocked = !mail && driveSyncBlocked
    const next = {
      title: src.displayName,
      onRefresh: hubSourceHeaderRefresh,
      refreshDisabled: Boolean(sourceSyncAction) || blocked,
      refreshSpinning: Boolean(sourceSyncAction === 'refresh' || (!mail && indexRefreshPending)),
      refreshTitle: blocked
        ? 'Add at least one Drive folder in the list below before syncing'
        : undefined,
    }
    if (!hubSourceHeaderCtrl?.isOwner) {
      hubSourceHeaderCtrl = hubSourceHeaderCell.claim(next)
    } else {
      hubSourceHeaderCtrl.patch(next)
    }
  })

  onDestroy(() => {
    hubSourceHeaderCtrl?.clear()
    hubSourceHeaderCtrl = null
  })

  const hubDialogBtnBase =
    'hub-dialog-btn cursor-pointer rounded-md border border-transparent px-[0.9rem] py-[0.45rem] text-sm font-semibold transition-[background-color,color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-60'
  const hubDialogBtnDanger =
    'hub-dialog-btn-danger bg-[color-mix(in_srgb,var(--danger)_14%,var(--bg))] text-danger border-[color-mix(in_srgb,var(--danger)_40%,transparent)] hover:not-disabled:bg-[color-mix(in_srgb,var(--danger)_24%,var(--bg))]'
</script>

<div class="hub-connector-source min-h-0 flex-1 overflow-auto px-5 pb-6 pt-4">
  {#if loadError}
    <p class="hub-connector-err m-0 text-[0.9375rem] leading-[1.45] text-danger" role="alert">
      {loadError}
    </p>
  {:else if source}
    <div class="hub-connector-inner flex flex-col gap-4">
      <HubConnectorSourceMeta {source} />
      {#if !isMailSourceKind(source.kind)}
        <HubConnectorIndexSections
          {sourceDetailError}
          {sourceDetail}
          {driveSyncBlocked}
          {sourceSyncAction}
          {indexRefreshPending}
          {showInlineRefresh}
          onRefresh={() => void hubSourceRefresh()}
          onReloadDetail={() => void loadSourceDetail({ keepPreviousDetail: true })}
        />
      {/if}
      {#if source.kind === 'imap' || source.kind === 'applemail'}
        <HubConnectorMailSections
          mailKind={source.kind}
          {mailStatus}
          {mailStatusLoading}
          {mailStatusError}
          {includedInDefault}
          {isDefaultSend}
          {prefsBusy}
          {prefsError}
          bind:backfillWindow
          {sourceSyncAction}
          {showInlineRefresh}
          onToggleIncludedInDefault={() => void toggleIncludedInDefault()}
          onSetDefaultSend={(checked) => void setDefaultSend(checked)}
          onRefresh={() => void hubSourceRefresh()}
          onBackfill={() => void hubSourceBackfill()}
        />
      {/if}
      <div
        class="hub-connector-footer mt-1 flex flex-wrap justify-end gap-2 border-t border-[color-mix(in_srgb,var(--border)_50%,transparent)] pt-4"
      >
        <button
          type="button"
          class={cn(hubDialogBtnBase, hubDialogBtnDanger)}
          disabled={removingSource}
          onclick={() => void confirmRemoveSource()}
        >
          {removingSource ? 'Removing…' : 'Remove from index'}
        </button>
      </div>
    </div>
  {:else}
    <p class="hub-connector-loading m-0 text-[0.9375rem] leading-[1.45] text-muted" role="status">
      Loading…
    </p>
  {/if}
</div>
