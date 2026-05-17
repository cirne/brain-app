<script lang="ts">
  import { onDestroy } from 'svelte'
  import { emit } from '@client/lib/app/appEvents.js'
  import { createAsyncLatest, isAbortError } from '@client/lib/asyncLatest.js'
  import { getHubSourceSlideHeaderCell } from '@client/lib/hubSourceSlideHeaderContext.js'
  import {
    type HubMailStatusOk,
    type HubRipmailSourceRow,
    type HubSourceDetailOk,
  } from '@client/lib/hub/hubRipmailSource.js'
  import { sourcesForGoogleAccountPanel } from '@client/lib/hub/hubGoogleAccountConnections.js'
  import HubConnectorIndexSections from '@components/hub-connector/HubConnectorIndexSections.svelte'
  import HubConnectorMailSections from '@components/hub-connector/HubConnectorMailSections.svelte'
  import SettingsSectionH2 from '@components/settings/SettingsSectionH2.svelte'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    accountEmail: string | undefined
    onClose: () => void
  }

  let { accountEmail, onClose }: Props = $props()

  const hubListLatest = createAsyncLatest({ abortPrevious: true })
  const hubMailLatest = createAsyncLatest({ abortPrevious: true })
  const calDetailLatest = createAsyncLatest({ abortPrevious: true })
  const driveDetailLatest = createAsyncLatest({ abortPrevious: true })

  let hubSources = $state<HubRipmailSourceRow[]>([])
  let loadError = $state<string | null>(null)
  let mailStatus = $state<HubMailStatusOk | null>(null)
  let mailStatusLoading = $state(false)
  let mailStatusError = $state<string | null>(null)
  let isDefaultSend = $state<boolean | null>(null)
  let prefsBusy = $state<'default-send' | null>(null)
  let prefsError = $state<string | null>(null)
  let mailSyncAction = $state<'refresh' | 'backfill' | null>(null)
  let calDetail = $state<HubSourceDetailOk | null>(null)
  let calDetailError = $state<string | null>(null)
  let calDetailLoading = $state(false)
  let driveDetail = $state<HubSourceDetailOk | null>(null)
  let driveDetailError = $state<string | null>(null)
  let driveDetailLoading = $state(false)
  let calSyncAction = $state<'refresh' | null>(null)
  let driveSyncAction = $state<'refresh' | null>(null)
  let calIndexRefreshPending = $state(false)
  let driveIndexRefreshPending = $state(false)
  let calIndexBaseline = $state<{
    docs: number
    cal: number
    last: string | null
  } | null>(null)
  let driveIndexBaseline = $state<{
    docs: number
    cal: number
    last: string | null
  } | null>(null)
  let calIndexStartedAt = $state<number | null>(null)
  let driveIndexStartedAt = $state<number | null>(null)

  let removingMail = $state(false)
  let removingCal = $state(false)
  let removingDrive = $state(false)
  let accountHeaderRefreshing = $state(false)

  const hubSourceHeaderCell = getHubSourceSlideHeaderCell()
  const showInlineRefresh = $derived(hubSourceHeaderCell === undefined)

  const INDEX_REFRESH_MAX_MS = 15 * 60 * 1000

  const matched = $derived.by(() => {
    const em = accountEmail?.trim() ?? ''
    if (!em) return [] as HubRipmailSourceRow[]
    return sourcesForGoogleAccountPanel(hubSources, em)
  })
  const mailRow = $derived(matched.find((s) => s.kind === 'imap'))
  const calRow = $derived(matched.find((s) => s.kind === 'googleCalendar'))
  const driveRow = $derived(matched.find((s) => s.kind === 'googleDrive'))

  const displayTitle = $derived(accountEmail?.trim() || $t('hub.googleAccountPanel.errors.noAccount'))

  const btnDangerLink =
    'm-0 cursor-pointer border-0 bg-transparent p-0 text-[0.8125rem] font-semibold text-danger underline decoration-[color-mix(in_srgb,var(--danger)_55%,transparent)] underline-offset-2 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

  function maybeClearCalPending(detail: HubSourceDetailOk) {
    if (!calIndexRefreshPending || calIndexStartedAt == null) return
    if (Date.now() - calIndexStartedAt > INDEX_REFRESH_MAX_MS) {
      calIndexRefreshPending = false
      calIndexBaseline = null
      calIndexStartedAt = null
      return
    }
    const b = calIndexBaseline
    const st = detail.status
    if (b == null) {
      if (st?.lastSyncedAt != null) {
        calIndexRefreshPending = false
        calIndexBaseline = null
        calIndexStartedAt = null
      }
      return
    }
    if (!st) return
    if (
      st.documentIndexRows !== b.docs ||
      st.calendarEventRows !== b.cal ||
      (st.lastSyncedAt ?? '') !== (b.last ?? '')
    ) {
      calIndexRefreshPending = false
      calIndexBaseline = null
      calIndexStartedAt = null
    }
  }

  function maybeClearDrivePending(detail: HubSourceDetailOk) {
    if (!driveIndexRefreshPending || driveIndexStartedAt == null) return
    if (Date.now() - driveIndexStartedAt > INDEX_REFRESH_MAX_MS) {
      driveIndexRefreshPending = false
      driveIndexBaseline = null
      driveIndexStartedAt = null
      return
    }
    const b = driveIndexBaseline
    const st = detail.status
    if (b == null) {
      if (st?.lastSyncedAt != null) {
        driveIndexRefreshPending = false
        driveIndexBaseline = null
        driveIndexStartedAt = null
      }
      return
    }
    if (!st) return
    if (
      st.documentIndexRows !== b.docs ||
      st.calendarEventRows !== b.cal ||
      (st.lastSyncedAt ?? '') !== (b.last ?? '')
    ) {
      driveIndexRefreshPending = false
      driveIndexBaseline = null
      driveIndexStartedAt = null
    }
  }

  async function loadMailPrefs(mailId: string) {
    try {
      const res = await fetch('/api/hub/sources/mail-prefs')
      if (!res.ok) return
      const j = (await res.json()) as {
        ok?: boolean
        defaultSendSource?: string | null
      }
      if (!j.ok) return
      isDefaultSend = j.defaultSendSource === mailId
    } catch {
      /* keep */
    }
  }

  async function setDefaultSend(makeDefault: boolean) {
    const id = mailRow?.id
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
        throw new Error(
          typeof j.error === 'string'
            ? j.error
            : $t('hub.hubConnectorSourcePanel.errors.updateDefaultSendMailbox'),
        )
      }
      isDefaultSend = j.defaultSendSource === id
      emit({ type: 'hub:sources-changed' })
    } catch (e) {
      prefsError =
        e instanceof Error
          ? e.message
          : $t('hub.hubConnectorSourcePanel.errors.updateDefaultSendMailbox')
    } finally {
      prefsBusy = null
    }
  }

  async function loadMailStatus(mailId: string) {
    const { token, signal } = hubMailLatest.begin()
    mailStatusLoading = true
    mailStatusError = null
    try {
      const res = await fetch(`/api/hub/sources/mail-status?id=${encodeURIComponent(mailId)}`, {
        signal,
      })
      if (hubMailLatest.isStale(token)) return
      const j = (await res.json()) as HubMailStatusOk | { ok: false; error?: string }
      if (hubMailLatest.isStale(token)) return
      if (!j.ok) {
        mailStatusError =
          typeof (j as { error?: string }).error === 'string'
            ? (j as { error: string }).error
            : $t('hub.hubConnectorSourcePanel.errors.loadStatus')
        return
      }
      mailStatusError = null
      mailStatus = j
    } catch (e) {
      if (hubMailLatest.isStale(token) || isAbortError(e)) return
      mailStatusError =
        e instanceof Error ? e.message : $t('hub.hubConnectorSourcePanel.errors.loadStatus')
    } finally {
      if (!hubMailLatest.isStale(token)) mailStatusLoading = false
    }
  }

  async function loadDetail(
    id: string,
    which: 'cal' | 'drive',
    opts?: { keepPrevious?: boolean },
  ) {
    const keep = opts?.keepPrevious === true
    const latest = which === 'cal' ? calDetailLatest : driveDetailLatest
    const { token, signal } = latest.begin()
    if (which === 'cal') {
      if (!keep) {
        calDetailLoading = true
        calDetailError = null
        calDetail = null
      }
    } else {
      if (!keep) {
        driveDetailLoading = true
        driveDetailError = null
        driveDetail = null
      }
    }
    try {
      const res = await fetch(`/api/hub/sources/detail?id=${encodeURIComponent(id)}`, { signal })
      if (latest.isStale(token)) return
      const j = (await res.json()) as HubSourceDetailOk | { ok: false; error?: string }
      if (latest.isStale(token)) return
      if (!res.ok || !j.ok) {
        const err =
          typeof (j as { error?: string }).error === 'string'
            ? (j as { error: string }).error
            : $t('hub.hubConnectorSourcePanel.errors.loadSourceDetail')
        if (which === 'cal') calDetailError = err
        else driveDetailError = err
        return
      }
      const next = j as HubSourceDetailOk
      if (which === 'cal') {
        calDetailError = null
        calDetail = next
        maybeClearCalPending(next)
      } else {
        driveDetailError = null
        driveDetail = next
        maybeClearDrivePending(next)
      }
    } catch (e) {
      if (latest.isStale(token) || isAbortError(e)) return
      const msg =
        e instanceof Error ? e.message : $t('hub.hubConnectorSourcePanel.errors.loadSourceDetail')
      if (which === 'cal') calDetailError = msg
      else driveDetailError = msg
    } finally {
      if (!latest.isStale(token)) {
        if (which === 'cal') calDetailLoading = false
        else driveDetailLoading = false
      }
    }
  }

  async function loadHubList() {
    const { token, signal } = hubListLatest.begin()
    loadError = null
    try {
      const res = await fetch('/api/hub/sources', { signal })
      if (hubListLatest.isStale(token)) return
      const j = (await res.json()) as { sources?: HubRipmailSourceRow[]; error?: string }
      if (hubListLatest.isStale(token)) return
      if (!res.ok) {
        throw new Error(
          typeof j.error === 'string' ? j.error : $t('hub.googleAccountPanel.errors.loadSources'),
        )
      }
      hubSources = Array.isArray(j.sources) ? j.sources : []
      const em = accountEmail?.trim() ?? ''
      if (em && sourcesForGoogleAccountPanel(hubSources, em).length === 0) {
        loadError = $t('hub.googleAccountPanel.errors.emptyAccount')
      }
    } catch (e) {
      if (hubListLatest.isStale(token) || isAbortError(e)) return
      loadError = e instanceof Error ? e.message : $t('hub.googleAccountPanel.errors.loadSources')
    }
  }

  async function reloadMembers() {
    const em = accountEmail?.trim()
    await loadHubList()
    if (!em || loadError) return
    const group = sourcesForGoogleAccountPanel(hubSources, em)
    const m = group.find((s) => s.kind === 'imap')
    if (m?.id) {
      void loadMailStatus(m.id)
      void loadMailPrefs(m.id)
    } else {
      mailStatus = null
      isDefaultSend = null
    }
    const c = group.find((s) => s.kind === 'googleCalendar')
    if (c?.id) void loadDetail(c.id, 'cal')
    else {
      calDetail = null
      calDetailError = null
    }
    const d = group.find((s) => s.kind === 'googleDrive')
    if (d?.id) void loadDetail(d.id, 'drive')
    else {
      driveDetail = null
      driveDetailError = null
    }
  }

  async function postRefresh(id: string) {
    const res = await fetch('/api/hub/sources/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || !j.ok) {
      throw new Error(
        typeof j.error === 'string' ? j.error : $t('hub.hubConnectorSourcePanel.errors.startRefresh'),
      )
    }
  }

  function hubSourceHeaderRefresh() {
    void accountRefreshAll()
  }

  async function accountRefreshAll() {
    if (accountHeaderRefreshing || mailSyncAction || calSyncAction || driveSyncAction) return
    const m = mailRow?.id
    const c = calRow?.id
    const d = driveRow?.id
    const ids = [m, c, d].filter(Boolean) as string[]
    if (ids.length === 0) return
    accountHeaderRefreshing = true
    try {
      if (c) {
        calIndexRefreshPending = true
        calIndexStartedAt = Date.now()
        calIndexBaseline = calDetail?.status
          ? {
              docs: calDetail.status.documentIndexRows,
              cal: calDetail.status.calendarEventRows,
              last: calDetail.status.lastSyncedAt,
            }
          : null
      }
      if (d) {
        driveIndexRefreshPending = true
        driveIndexStartedAt = Date.now()
        driveIndexBaseline = driveDetail?.status
          ? {
              docs: driveDetail.status.documentIndexRows,
              cal: driveDetail.status.calendarEventRows,
              last: driveDetail.status.lastSyncedAt,
            }
          : null
      }
      for (const id of ids) {
        await postRefresh(id)
      }
      await reloadMembers()
      if (mailRow?.id) await loadMailStatus(mailRow.id)
    } catch (e) {
      calIndexRefreshPending = false
      driveIndexRefreshPending = false
      calIndexBaseline = null
      driveIndexBaseline = null
      calIndexStartedAt = null
      driveIndexStartedAt = null
      alert(e instanceof Error ? e.message : $t('hub.hubConnectorSourcePanel.errors.startRefresh'))
    } finally {
      accountHeaderRefreshing = false
    }
  }

  async function calRefresh() {
    const id = calRow?.id
    if (!id || calSyncAction) return
    calSyncAction = 'refresh'
    calIndexRefreshPending = true
    calIndexStartedAt = Date.now()
    calIndexBaseline = calDetail?.status
      ? {
          docs: calDetail.status.documentIndexRows,
          cal: calDetail.status.calendarEventRows,
          last: calDetail.status.lastSyncedAt,
        }
      : null
    try {
      await postRefresh(id)
      void loadDetail(id, 'cal', { keepPrevious: true })
    } catch (e) {
      calIndexRefreshPending = false
      calIndexBaseline = null
      calIndexStartedAt = null
      alert(e instanceof Error ? e.message : $t('hub.hubConnectorSourcePanel.errors.startRefresh'))
    } finally {
      calSyncAction = null
    }
  }

  async function driveRefresh() {
    const id = driveRow?.id
    if (!id || driveSyncAction) return
    driveSyncAction = 'refresh'
    driveIndexRefreshPending = true
    driveIndexStartedAt = Date.now()
    driveIndexBaseline = driveDetail?.status
      ? {
          docs: driveDetail.status.documentIndexRows,
          cal: driveDetail.status.calendarEventRows,
          last: driveDetail.status.lastSyncedAt,
        }
      : null
    try {
      await postRefresh(id)
      void loadDetail(id, 'drive', { keepPrevious: true })
    } catch (e) {
      driveIndexRefreshPending = false
      driveIndexBaseline = null
      driveIndexStartedAt = null
      alert(e instanceof Error ? e.message : $t('hub.hubConnectorSourcePanel.errors.startRefresh'))
    } finally {
      driveSyncAction = null
    }
  }

  async function removeSource(
    id: string | undefined,
    kind: 'email' | 'calendar' | 'drive',
    busySetter: (_busy: boolean) => void,
  ) {
    if (!id) return
    const key =
      kind === 'email' ? 'email' : kind === 'calendar' ? 'calendar' : 'drive'
    if (!confirm($t(`hub.googleAccountPanel.confirmRemove.${key}`))) return
    busySetter(true)
    try {
      const res = await fetch('/api/hub/sources/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : $t('hub.hubConnectorSourcePanel.errors.removeSource'))
      }
      emit({ type: 'hub:sources-changed' })
      await loadHubList()
      const em = accountEmail?.trim() ?? ''
      const still = sourcesForGoogleAccountPanel(hubSources, em)
      if (still.length === 0) onClose()
      else await reloadMembers()
    } catch (e) {
      alert(e instanceof Error ? e.message : $t('hub.hubConnectorSourcePanel.errors.removeSource'))
    } finally {
      busySetter(false)
    }
  }

  $effect(() => {
    accountEmail
    hubMailLatest.begin()
    void reloadMembers()
  })

  $effect(() => {
    const id = mailRow?.id
    if (!id?.trim()) return
    const tmr = window.setInterval(() => void loadMailStatus(id), 6000)
    return () => window.clearInterval(tmr)
  })

  const driveSyncBlocked = false
  const headerBusy = $derived(
    accountHeaderRefreshing ||
      mailSyncAction !== null ||
      calSyncAction !== null ||
      driveSyncAction !== null ||
      calIndexRefreshPending ||
      driveIndexRefreshPending,
  )

  let hubSourceHeaderCtrl:
    | ReturnType<NonNullable<typeof hubSourceHeaderCell>['claim']>
    | null = null

  $effect(() => {
    if (!hubSourceHeaderCell) return
    const next = {
      title: displayTitle,
      onRefresh: hubSourceHeaderRefresh,
      refreshDisabled: headerBusy || matched.length === 0,
      refreshSpinning: headerBusy,
      refreshAriaLabel: $t('nav.hub.refreshIndex'),
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
</script>

<div class="google-account-panel min-h-0 flex-1 overflow-auto px-5 pb-6 pt-4">
  {#if !accountEmail?.trim()}
    <p class="m-0 text-[0.9375rem] leading-[1.45] text-danger" role="alert">
      {$t('hub.googleAccountPanel.errors.noAccount')}
    </p>
  {:else if loadError}
    <p class="m-0 text-[0.9375rem] leading-[1.45] text-danger" role="alert">{loadError}</p>
  {:else}
    <div class="flex flex-col gap-6">
      {#if mailRow}
        <section class="flex flex-col gap-3" aria-labelledby="gacct-mail-h2">
          <SettingsSectionH2 id="gacct-mail-h2" label={$t('hub.googleAccountPanel.sections.email')} />
          <HubConnectorMailSections
            mailKind={mailRow.kind}
            {mailStatus}
            {mailStatusLoading}
            {mailStatusError}
            {isDefaultSend}
            {prefsBusy}
            {prefsError}
            skipLeadingDivider={true}
            onSetDefaultSend={(c) => void setDefaultSend(c)}
          />
          <div class="flex justify-end">
            <button
              type="button"
              class={btnDangerLink}
              disabled={removingMail}
              onclick={() => void removeSource(mailRow.id, 'email', (v) => (removingMail = v))}
            >
              {removingMail
                ? $t('hub.hubConnectorSourcePanel.actions.removing')
                : $t('hub.googleAccountPanel.remove.email')}
            </button>
          </div>
        </section>
      {/if}

      {#if calRow}
        <section class="flex flex-col gap-3" aria-labelledby="gacct-cal-h2">
          <SettingsSectionH2 id="gacct-cal-h2" label={$t('hub.googleAccountPanel.sections.calendar')} />
          {#if calDetailLoading && !calDetail}
            <p class="m-0 text-[0.9375rem] text-muted" role="status">{$t('common.status.loading')}</p>
          {:else if calDetailError}
            <p class="m-0 text-[0.9375rem] text-danger" role="alert">{calDetailError}</p>
          {:else if calDetail}
            <HubConnectorIndexSections
              sourceDetailError={null}
              sourceDetail={calDetail}
              {driveSyncBlocked}
              sourceSyncAction={calSyncAction}
              indexRefreshPending={calIndexRefreshPending}
              showInlineRefresh={showInlineRefresh}
              calendarPickerCompact={true}
              onRefresh={() => void calRefresh()}
              onReloadDetail={() => void loadDetail(calDetail.id, 'cal', { keepPrevious: true })}
            />
          {/if}
          <div class="flex justify-end">
            <button
              type="button"
              class={btnDangerLink}
              disabled={removingCal}
              onclick={() => void removeSource(calRow.id, 'calendar', (v) => (removingCal = v))}
            >
              {removingCal
                ? $t('hub.hubConnectorSourcePanel.actions.removing')
                : $t('hub.googleAccountPanel.remove.calendar')}
            </button>
          </div>
        </section>
      {/if}

      {#if driveRow}
        <section class="flex flex-col gap-3" aria-labelledby="gacct-drive-h2">
          <SettingsSectionH2 id="gacct-drive-h2" label={$t('hub.googleAccountPanel.sections.drive')} />
          {#if driveDetailLoading && !driveDetail}
            <p class="m-0 text-[0.9375rem] text-muted" role="status">{$t('common.status.loading')}</p>
          {:else if driveDetailError}
            <p class="m-0 text-[0.9375rem] text-danger" role="alert">{driveDetailError}</p>
          {:else if driveDetail}
            <HubConnectorIndexSections
              sourceDetailError={null}
              sourceDetail={driveDetail}
              {driveSyncBlocked}
              sourceSyncAction={driveSyncAction}
              indexRefreshPending={driveIndexRefreshPending}
              showInlineRefresh={showInlineRefresh}
              onRefresh={() => void driveRefresh()}
              onReloadDetail={() => void loadDetail(driveDetail.id, 'drive', { keepPrevious: true })}
            />
          {/if}
          <div class="flex justify-end">
            <button
              type="button"
              class={btnDangerLink}
              disabled={removingDrive}
              onclick={() => void removeSource(driveRow.id, 'drive', (v) => (removingDrive = v))}
            >
              {removingDrive
                ? $t('hub.hubConnectorSourcePanel.actions.removing')
                : $t('hub.googleAccountPanel.remove.drive')}
            </button>
          </div>
        </section>
      {/if}
    </div>
  {/if}
</div>
