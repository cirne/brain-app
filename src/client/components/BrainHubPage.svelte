<script lang="ts">
  import { onMount } from 'svelte'
  import {
    User,
    Mail,
    RefreshCw,
    ChevronRight,
    BookOpen,
    Smartphone,
    Folder,
    FolderPlus,
    Calendar,
    Layers,
    FileText,
    List,
    LogOut,
    Plus,
    Trash2,
  } from 'lucide-svelte'
  import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import type { OnboardingMailStatus } from '@client/lib/onboarding/onboardingTypes.js'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { wikiPathParentDir } from '@client/lib/wikiPathDisplay.js'
  import {
    fetchVaultStatus,
    postVaultDeleteAllData,
    postVaultLogout,
  } from '@client/lib/vaultClient.js'
  import { clearBrainClientStorage } from '@client/lib/brainClientStorage.js'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import HubSourceRowBody from './HubSourceRowBody.svelte'
  import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'

  type HubRipmailSourceRow = {
    id: string
    kind: string
    displayName: string
    path: string | null
  }

  type Props = {
    /** All hub drill-downs use the same overlay + `SlideOver` stack as the chat shell. */
    onHubNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
  }

  let { onHubNavigate }: Props = $props()

  let docCount = $state<number | null>(null)
  let wikiDoc = $state<BackgroundAgentDoc | null>(null)
  let mailStatus = $state<OnboardingMailStatus | null>(null)
  let hubSources = $state<HubRipmailSourceRow[]>([])
  let hubSourcesError = $state<string | null>(null)
  /** Set of IMAP source ids that are excluded from default search (`includeInDefault === false`). */
  let mailHiddenFromDefault = $state<Set<string>>(new Set())
  /** Source id chosen to send from when no source is named (Phase 2). */
  let defaultSendSourceId = $state<string | null>(null)
  /** Banner shown after the add-account redirect lands back on /hub. */
  let addAccountBanner = $state<{ kind: 'ok' | 'err'; message: string } | null>(null)
  /** Newest-first from `/api/wiki/edit-history`, else `/api/wiki/recent` when log is empty. */
  let wikiRecentEdits = $state<{ path: string; date: string }[]>([])
  let wikiRecentReady = $state(false)
  /** Hosted (`BRAIN_DATA_ROOT`): hide phone QR; show sign-out / delete data. */
  let multiTenant = $state(false)
  /** Hosted: `@handle` under the page title (also in the app bar on wide viewports). */
  let hostedWorkspaceHandle = $state<string | undefined>(undefined)
  let accountBusy = $state(false)
  let deleteAllConfirmOpen = $state(false)

  const wikiPhase = $derived(wikiDoc?.phase as YourWikiPhase | undefined)
  const wikiIsActive = $derived(
    wikiPhase === 'starting' || wikiPhase === 'enriching' || wikiPhase === 'cleaning',
  )
  const wikiIsPaused = $derived(wikiPhase === 'paused')

  /** Match BrainHubWidget / Your Wiki header: `pageCount` from the supervisor doc; `/api/wiki` only until events load. */
  const wikiPageCount = $derived(wikiDoc != null ? wikiDoc.pageCount : docCount)

  function wikiPathBasename(rel: string): string {
    const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts[parts.length - 1] ?? rel
  }

  async function fetchWikiRecentEditsList(): Promise<{ path: string; date: string }[]> {
    try {
      const histRes = await fetch('/api/wiki/edit-history?limit=5')
      if (histRes.ok) {
        const j = (await histRes.json()) as { files?: { path: string; date: string }[] }
        const files = Array.isArray(j.files) ? j.files : []
        if (files.length > 0) return files
      }
      const recentRes = await fetch('/api/wiki/recent?limit=5')
      if (recentRes.ok) {
        const j = (await recentRes.json()) as { files?: { path: string; date: string }[] }
        return Array.isArray(j.files) ? j.files : []
      }
    } catch {
      /* ignore */
    }
    return []
  }

  /** Primary line: what the user should understand is happening (not internal loop jargon). */
  const wikiHubTitle = $derived.by(() => {
    if (!wikiDoc) return 'Your Wiki'
    switch (wikiPhase) {
      case 'starting':
        return 'Building your first pages'
      case 'enriching':
        return 'Expanding your wiki'
      case 'cleaning':
        return 'Tidying links and pages'
      case 'paused':
        return 'Wiki updates paused'
      case 'error':
        return 'Something went wrong'
      case 'idle':
        return wikiDoc.detail === 'Pausing between laps' ? 'Taking a short break' : 'Wiki is up to date'
      default:
        return 'Your Wiki'
    }
  })

  /** Secondary line: last touched page when known, else a short status hint. */
  const wikiHubSub = $derived.by(() => {
    if (!wikiDoc) return 'Loading status…'
    const last = wikiDoc.lastWikiPath?.trim()
    const lastLine = last ? `Last: ${wikiPathBasename(last)}` : null

    switch (wikiPhase) {
      case 'starting':
        return lastLine ?? 'Getting everything ready…'
      case 'enriching':
        if (lastLine) return lastLine
        if ((wikiDoc.detail ?? '').includes('Sync')) return wikiDoc.detail ?? 'Preparing sources…'
        return 'Looking for pages to improve'
      case 'cleaning':
        return lastLine ?? 'Cleaning up from the last pass'
      case 'paused':
        return lastLine ?? 'Resume anytime from the detail view'
      case 'error': {
        const msg = (wikiDoc.error ?? wikiDoc.detail ?? 'Open for details').trim()
        return msg.length > 140 ? `${msg.slice(0, 137)}…` : msg
      }
      case 'idle':
        if (wikiDoc.detail === 'Pausing between laps') {
          return lastLine ?? 'Next pass soon'
        }
        if (wikiDoc.idleReason) {
          const short = wikiDoc.idleReason.split(/\s*[—–-]\s*/)[0]?.trim() ?? wikiDoc.idleReason
          return lastLine ? `${short} · ${lastLine}` : short
        }
        return lastLine ?? (wikiPageCount != null ? `${wikiPageCount} pages in your wiki` : 'Ready when you are')
      default:
        return lastLine ?? (wikiDoc.detail || '…')
    }
  })

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

  function sourceTier(kind: string): number {
    if (kind === 'imap' || kind === 'applemail') return 0
    if (
      kind === 'googleCalendar' ||
      kind === 'appleCalendar' ||
      kind === 'icsSubscription' ||
      kind === 'icsFile'
    ) {
      return 1
    }
    if (kind === 'localDir') return 2
    return 3
  }

  function sourceRowSecondary(s: HubRipmailSourceRow): string {
    const k = sourceKindLabel(s.kind)
    if (s.path) return `${k} · ${s.path}`
    return k
  }

  const orderedHubSources = $derived(
    [...hubSources].sort((a, b) => {
      const t = sourceTier(a.kind) - sourceTier(b.kind)
      if (t !== 0) return t
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    }),
  )

  async function fetchData() {
    try {
      const [wikiRes, mailRes, sourcesRes, mailPrefsRes] = await Promise.all([
        fetch('/api/wiki'),
        fetch('/api/onboarding/mail'),
        fetch('/api/hub/sources'),
        fetch('/api/hub/sources/mail-prefs'),
      ])

      if (wikiRes.ok) {
        const docs = await wikiRes.json()
        docCount = Array.isArray(docs) ? docs.length : null
      }
      if (mailRes.ok) {
        mailStatus = await mailRes.json()
      }
      if (sourcesRes.ok) {
        const j = (await sourcesRes.json()) as { sources?: HubRipmailSourceRow[]; error?: string }
        hubSources = Array.isArray(j.sources) ? j.sources : []
        hubSourcesError = typeof j.error === 'string' && j.error.trim() ? j.error : null
      }
      if (mailPrefsRes.ok) {
        const j = (await mailPrefsRes.json()) as {
          ok?: boolean
          mailboxes?: { id: string; includeInDefault: boolean }[]
          defaultSendSource?: string | null
        }
        if (j.ok && Array.isArray(j.mailboxes)) {
          const next = new Set<string>()
          for (const m of j.mailboxes) {
            if (m && m.includeInDefault === false) next.add(m.id)
          }
          mailHiddenFromDefault = next
        }
        defaultSendSourceId = typeof j.defaultSendSource === 'string' ? j.defaultSendSource : null
      }
      wikiRecentEdits = await fetchWikiRecentEditsList()
    } catch {
      /* ignore */
    } finally {
      wikiRecentReady = true
    }
  }

  /**
   * After `/api/oauth/google/link/callback` redirects back to `/hub?addedAccount=...`, surface a
   * non-blocking banner and strip the query so a refresh doesn't repeat the toast.
   */
  function consumeAddAccountQuery() {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const ok = url.searchParams.get('addedAccount')
    const err = url.searchParams.get('addAccountError')
    if (!ok && !err) return
    if (ok) {
      addAccountBanner = { kind: 'ok', message: `Added ${ok}. Braintunnel is syncing this mailbox now.` }
    } else if (err) {
      addAccountBanner = { kind: 'err', message: err }
    }
    url.searchParams.delete('addedAccount')
    url.searchParams.delete('addAccountError')
    const next = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : '') + url.hash
    history.replaceState(null, '', next)
    window.setTimeout(() => {
      addAccountBanner = null
    }, 8000)
  }

  function startAddAnotherGmail() {
    window.location.assign('/api/oauth/google/link/start')
  }

  onMount(() => {
    void fetchVaultStatus()
      .then((v) => {
        multiTenant = v.multiTenant === true
        if (
          v.multiTenant === true &&
          v.handleConfirmed === true &&
          typeof v.workspaceHandle === 'string' &&
          v.workspaceHandle.length > 0
        ) {
          hostedWorkspaceHandle = v.workspaceHandle
        } else {
          hostedWorkspaceHandle = undefined
        }
      })
      .catch(() => {
        multiTenant = false
        hostedWorkspaceHandle = undefined
      })
    consumeAddAccountQuery()
    void fetchData()
    const unsubEvents = subscribe((e) => {
      if (
        e.type === 'hub:sources-changed' ||
        e.type === 'wiki:mutated' ||
        e.type === 'sync:completed'
      )
        void fetchData()
    })
    const unsubWikiStore = yourWikiDocFromEvents.subscribe((doc) => {
      if (doc) wikiDoc = doc
    })
    return () => {
      unsubEvents()
      unsubWikiStore()
    }
  })

  function formatRelativeDate(iso: string): string {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffSec < 60) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHour < 24) return `${diffHour}h ago`
    if (diffDay === 1) return 'Yesterday'
    if (diffDay < 7) return `${diffDay}d ago`
    return d.toLocaleDateString()
  }

  /** Shown next to “Syncing…” when lock age ≥ 1m (subtle progress hint). */
  function formatSyncLockAge(ms: number | null): string {
    if (ms == null || ms < 60_000) return ''
    const m = Math.floor(ms / 60_000)
    if (m < 60) return ` · ${m}m`
    const h = Math.floor(m / 60)
    return ` · ${h}h`
  }

  async function onLogout() {
    if (accountBusy) return
    accountBusy = true
    try {
      await postVaultLogout()
      clearBrainClientStorage()
      window.location.assign('/')
    } finally {
      accountBusy = false
    }
  }

  function openDeleteAllConfirm() {
    if (accountBusy) return
    deleteAllConfirmOpen = true
  }

  async function executeDeleteAllData() {
    if (accountBusy) return
    accountBusy = true
    deleteAllConfirmOpen = false
    try {
      const r = await postVaultDeleteAllData()
      if ('error' in r) {
        alert(r.error)
        return
      }
      clearBrainClientStorage()
      window.location.assign('/')
    } finally {
      accountBusy = false
    }
  }
</script>

<div class="hub-page">
  <header class="hub-header">
    <div class="hub-header-content">
      <h1>Braintunnel Hub</h1>
      <div class="hub-header-deck" class:hub-header-deck--hosted={!!hostedWorkspaceHandle}>
        {#if hostedWorkspaceHandle}
          <p class="hub-handle-line" translate="no">@{hostedWorkspaceHandle}</p>
        {/if}
        <p class="hub-subtitle">Admin, settings, and system status</p>
      </div>
    </div>
  </header>

  {#if addAccountBanner}
    <div
      class="hub-add-account-banner"
      class:hub-add-account-banner--err={addAccountBanner.kind === 'err'}
      role={addAccountBanner.kind === 'err' ? 'alert' : 'status'}
    >
      {addAccountBanner.message}
      <button
        type="button"
        class="hub-add-account-banner-dismiss"
        aria-label="Dismiss"
        onclick={() => (addAccountBanner = null)}
      >×</button>
    </div>
  {/if}

  <div class="hub-grid">
    <!-- Section 1: Account / connectivity (phone QR is desktop-only; hosted shows sign-out + delete) -->
    <section id="hub-account-top" class="hub-section links-section" aria-busy={accountBusy}>
      <div class="section-header">
        {#if multiTenant}
          <User size={18} />
          <h2>Account</h2>
        {:else}
          <Smartphone size={18} />
          <h2>Access & Connectivity</h2>
        {/if}
      </div>
      <div class="links-list">
        <button
          type="button"
          class="link-item"
          onclick={() => onHubNavigate({ type: 'wiki', path: 'me.md' })}
        >
          <div class="link-info">
            <User size={16} />
            <span>Your Profile (me.md)</span>
          </div>
          <ChevronRight size={16} />
        </button>

        {#if multiTenant}
          <button type="button" class="link-item" onclick={onLogout} disabled={accountBusy}>
            <div class="link-info">
              <LogOut size={16} />
              <span>Sign out</span>
            </div>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            class="link-item"
            onclick={openDeleteAllConfirm}
            disabled={accountBusy}
          >
            <div class="link-info">
              <span class="hub-delete-trash-wrap" aria-hidden="true"><Trash2 size={16} /></span>
              <span>Delete all my data</span>
            </div>
            <div class="link-status">
              <span class="status-sub">Removes wiki, index, chats</span>
            </div>
            <ChevronRight size={16} />
          </button>
        {:else}
          <button type="button" class="link-item" onclick={() => onHubNavigate({ type: 'phone-access' })}>
            <div class="link-info">
              <Smartphone size={16} />
              <span>Phone Access</span>
            </div>
            <div class="link-status">
              <span class="status-sub">Scan QR code</span>
            </div>
            <ChevronRight size={16} />
          </button>
        {/if}
      </div>
    </section>

    <section class="hub-section search-index-section">
      <div class="section-header">
        <Layers size={18} />
        <h2>Search index</h2>
      </div>
      <p class="section-lead">
        Everything Braintunnel searches lives here: mail accounts, calendars, and your documents.
      </p>
      <div class="index-status-strip" role="status" aria-live="polite">
        {#if mailStatus?.statusError}
          <span class="index-status-err" title={mailStatus.statusError}>Mail index status unavailable</span>
        {:else if mailStatus}
          <span class="index-status-primary"
            >{mailStatus.indexedTotal != null ? mailStatus.indexedTotal : '—'} messages in index</span
          >
          {#if mailStatus.syncRunning}
            <span class="status-sub status-syncing">
              <span class="sync-dot" aria-hidden="true"></span>
              Syncing{formatSyncLockAge(mailStatus.syncLockAgeMs)}…
            </span>
          {:else if mailStatus.lastSyncedAt}
            <span class="status-sub">Last synced {formatRelativeDate(mailStatus.lastSyncedAt)}</span>
          {:else if mailStatus.configured}
            <span class="status-sub">No sync time yet</span>
          {/if}
        {:else}
          <span class="status-sub">Loading index status…</span>
        {/if}
      </div>
      <div class="links-list">
        {#if hubSourcesError}
          <p class="empty-msg hub-sources-err" title={hubSourcesError}>Could not load sources.</p>
        {:else if orderedHubSources.length === 0}
          <p class="empty-msg">
            {#if multiTenant}
              No sources yet. Connect mail or add calendars.
            {:else}
              No sources yet. Connect mail, add calendars, or add folders from chat.
            {/if}
          </p>
        {:else}
          {#each orderedHubSources as s (s.id)}
            {@const isMail = s.kind === 'imap' || s.kind === 'applemail'}
            {@const isDefaultSend = isMail && defaultSendSourceId === s.id}
            {@const isHidden = isMail && mailHiddenFromDefault.has(s.id)}
            <button
              type="button"
              class="link-item hub-source-row"
              onclick={() => onHubNavigate({ type: 'hub-source', id: s.id })}
            >
              <div class="link-info">
                <HubSourceRowBody title={s.displayName} subtitle={sourceRowSecondary(s)}>
                  {#snippet icon()}
                    {#if s.kind === 'localDir'}
                      <Folder size={16} />
                    {:else if s.kind === 'imap' || s.kind === 'applemail'}
                      <Mail size={16} />
                    {:else}
                      <Calendar size={16} />
                    {/if}
                  {/snippet}
                </HubSourceRowBody>
              </div>
              <div class="hub-source-row-flags" aria-hidden={!isMail}>
                {#if isDefaultSend}
                  <span class="hub-source-pill hub-source-pill--send" title="Default mailbox for sending">
                    Default send
                  </span>
                {/if}
                {#if isHidden}
                  <span class="hub-source-pill hub-source-pill--hidden" title="Excluded from default searches">
                    Hidden from search
                  </span>
                {/if}
              </div>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          {/each}
        {/if}
        <button
          type="button"
          class="link-item hub-source-row"
          onclick={startAddAnotherGmail}
        >
          <div class="link-info">
            <HubSourceRowBody
              title="Add another Gmail account"
              subtitle="Search and send from a second mailbox in the same workspace"
            >
              {#snippet icon()}
                <Plus size={16} />
              {/snippet}
            </HubSourceRowBody>
          </div>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        {#if !multiTenant}
          <button
            type="button"
            class="link-item hub-source-row"
            onclick={() => onHubNavigate({ type: 'hub-add-folders' })}
          >
            <div class="link-info">
              <HubSourceRowBody
                title="Add more folders"
                subtitle="Suggest Desktop and Documents to add to the index"
              >
                {#snippet icon()}
                  <FolderPlus size={16} />
                {/snippet}
              </HubSourceRowBody>
            </div>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        {/if}
      </div>
    </section>

    <!-- Section 2: Your Wiki -->
    <section class="hub-section your-wiki-section" aria-label="Your Wiki">
      <div class="section-header section-header-wiki">
        <BookOpen size={18} />
        <h2>Your Wiki</h2>
        <span
          class="wiki-header-metrics"
          aria-live="polite"
          aria-label={wikiPageCount != null ? `${wikiPageCount} pages` : 'Page count loading'}
        >
          <span class="wiki-header-count" aria-hidden="true">{wikiPageCount ?? '—'}</span>
          <span class="wiki-header-count-label" aria-hidden="true">pages</span>
        </span>
      </div>
      <div class="links-list">
        <button
          type="button"
          class="link-item hub-source-row"
          onclick={() => onHubNavigate({ type: 'your-wiki' })}
        >
          <div class="link-info">
            <HubSourceRowBody title={wikiHubTitle} subtitle={wikiHubSub}>
              {#snippet icon()}
                {#if wikiIsActive}
                  <RefreshCw size={16} class="spin-icon" aria-hidden="true" />
                {:else}
                  <BookOpen size={16} aria-hidden="true" />
                {/if}
              {/snippet}
            </HubSourceRowBody>
          </div>
          {#if wikiIsPaused}
            <div class="link-status">
              <span class="status-pill paused">Paused</span>
            </div>
          {/if}
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          class="link-item hub-source-row"
          onclick={() => onHubNavigate({ type: 'wiki' })}
        >
          <div class="link-info">
            <HubSourceRowBody title="Wiki index" subtitle="Browse your private wiki">
              {#snippet icon()}
                <List size={16} />
              {/snippet}
            </HubSourceRowBody>
          </div>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        {#if wikiRecentReady && wikiRecentEdits.length > 0}
          <div class="wiki-recent-block" aria-label="Recent wiki edits">
            <p class="wiki-recent-label">Recent edits</p>
            {#each wikiRecentEdits as f (f.path)}
              {@const parentDir = wikiPathParentDir(f.path)}
              <button
                type="button"
                class="link-item hub-source-row wiki-recent-row"
                onclick={() => onHubNavigate({ type: 'wiki', path: f.path })}
              >
                <div class="link-info wiki-recent-row-main">
                  <HubSourceRowBody
                    title={wikiPathBasename(f.path)}
                    subtitle={parentDir ?? 'Wiki root'}
                  >
                    {#snippet icon()}
                      <FileText size={16} />
                    {/snippet}
                  </HubSourceRowBody>
                </div>
                <div class="wiki-recent-row-meta">
                  <span class="status-sub wiki-recent-time">{formatRelativeDate(f.date)}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </div>
              </button>
            {/each}
          </div>
        {:else if wikiRecentReady}
          <p class="empty-msg wiki-recent-empty">No recent edits recorded yet.</p>
        {/if}
      </div>
    </section>

  </div>
</div>

<ConfirmDialog
  open={deleteAllConfirmOpen}
  title="Delete all your data?"
  titleId="hub-delete-all-title"
  confirmLabel="Delete everything"
  cancelLabel="Cancel"
  confirmVariant="danger"
  onDismiss={() => {
    deleteAllConfirmOpen = false
  }}
  onConfirm={() => void executeDeleteAllData()}
>
  {#snippet children()}
    <p>
      This permanently removes your wiki, chats, and profile from Braintunnel, plus the search library Braintunnel built from your mail
      and other sources. You can't undo it.
    </p>
    <p>
      Your email accounts stay as they are: Braintunnel doesn't change or delete messages at your provider, and you can keep
      using mail the same way you do today.
    </p>
  {/snippet}
</ConfirmDialog>

<style>
  .hub-add-account-banner {
    margin: 0;
    padding: 0.75rem 2.5rem 0.75rem 1rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-2));
    color: var(--text);
    font-size: 0.9375rem;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    position: relative;
  }

  .hub-add-account-banner--err {
    background: color-mix(in srgb, var(--danger) 12%, var(--bg-2));
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    color: var(--text);
  }

  .hub-add-account-banner-dismiss {
    position: absolute;
    top: 0.35rem;
    right: 0.5rem;
    background: transparent;
    border: none;
    color: var(--text-2);
    cursor: pointer;
    font-size: 1.25rem;
    line-height: 1;
    padding: 0.15rem 0.4rem;
    border-radius: 6px;
  }

  .hub-add-account-banner-dismiss:hover {
    color: var(--text);
  }

  .hub-source-row-flags {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    margin-right: 8px;
  }

  .hub-source-pill {
    font-size: 0.625rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .hub-source-pill--send {
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-2));
    color: color-mix(in srgb, var(--accent) 92%, var(--text));
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .hub-source-pill--hidden {
    background: var(--bg-3);
    color: var(--text-2);
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }

  .hub-page {
    padding: 2.5rem 2rem;
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 3rem;
    color: var(--text);
  }

  .hub-header {
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .hub-header-deck {
    margin: 0.5rem 0 0;
  }

  .hub-header-deck--hosted {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .hub-handle-line {
    margin: 0;
    font-size: 0.9375rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-weight: 500;
    color: var(--text-2);
    letter-spacing: 0.02em;
  }

  .hub-subtitle {
    margin: 0;
    color: var(--text-2);
    font-size: 1rem;
    font-weight: 450;
  }

  .hub-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 3.5rem;
  }

  .wiki-recent-block {
    display: flex;
    flex-direction: column;
    margin-top: 0.35rem;
    padding-top: 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  }

  .wiki-recent-label {
    margin: 0 0 0.35rem;
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-2);
  }

  .wiki-recent-row {
    padding-top: 0.45rem;
    padding-bottom: 0.45rem;
  }

  .wiki-recent-row-main {
    min-width: 0;
  }

  .wiki-recent-row-meta {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }

  .wiki-recent-time {
    font-size: 0.75rem;
    color: var(--text-2);
    white-space: nowrap;
  }

  .wiki-recent-empty {
    margin-top: 0.5rem;
    padding: 0.65rem 0 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    font-size: 0.8125rem;
  }

  .hub-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  :global(.spin-icon) {
    animation: spin 2s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text);
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .section-header-wiki .wiki-header-metrics {
    margin-left: auto;
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-shrink: 0;
  }

  .wiki-header-count {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.01em;
    font-variant-numeric: tabular-nums;
  }

  .wiki-header-count-label {
    font-size: 0.75rem;
    color: var(--text-2);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .links-list {
    display: flex;
    flex-direction: column;
  }

  .link-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: padding-left 0.2s ease, color 0.15s;
  }

  .link-item:hover:not(.static):not(.disabled):not(:disabled) {
    padding-left: 4px;
    color: var(--accent);
  }

  .link-item:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .hub-delete-trash-wrap {
    display: flex;
    flex-shrink: 0;
    color: var(--danger);
  }

  .hub-delete-trash-wrap :global(svg) {
    stroke: currentColor;
  }

  .link-item.wiki-recent-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 1rem;
  }

  .link-info {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
    font-size: 0.9375rem;
    font-weight: 500;
  }

  .status-pill {
    font-size: 0.625rem;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--bg-3);
    color: var(--text-2);
  }

  .status-pill.paused {
    background: color-mix(in srgb, var(--text-2) 22%, var(--bg-3));
    color: var(--text);
  }

  .link-status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .status-sub {
    font-size: 0.75rem;
    color: var(--text-2);
  }

  .status-syncing {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--accent);
    font-weight: 600;
  }

  .sync-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
    animation: hub-sync-pulse 1.2s ease-in-out infinite;
  }

  @keyframes hub-sync-pulse {
    0%,
    100% {
      opacity: 0.35;
      transform: scale(0.92);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }

  .section-lead {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    line-height: 1.45;
    max-width: 40rem;
  }

  .index-status-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.65rem 0 0.85rem;
    font-size: 0.8125rem;
    color: var(--text-2);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  }

  .index-status-primary {
    font-weight: 600;
    color: var(--text);
  }

  .index-status-err {
    color: var(--text-3);
    cursor: help;
  }

  .hub-sources-err {
    cursor: help;
  }

  .empty-msg {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    padding: 1rem 0;
  }

  @media (max-width: 767px) {
    .hub-page {
      padding: 1.5rem 1rem;
    }
  }
</style>
