<script lang="ts">
  import { onMount } from 'svelte'
  import {
    User,
    Mail,
    ChevronRight,
    Folder,
    Calendar,
    HardDrive,
    LogOut,
    Plus,
    Trash2,
    MessageSquare,
    Link2,
    Share2,
  } from 'lucide-svelte'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import { subscribe, emit } from '@client/lib/app/appEvents.js'
  import { fetchWikiSharesList, type WikiShareApiRow } from '@client/lib/wikiSharesClient.js'
  import {
    fetchVaultStatus,
    postVaultDeleteAllData,
    postVaultLogout,
  } from '@client/lib/vaultClient.js'
  import {
    readChatToolDisplayPreference,
    writeChatToolDisplayPreference,
    type ChatToolDisplayMode,
  } from '@client/lib/chatToolDisplayPreference.js'
  import { clearBrainClientStorage } from '@client/lib/brainClientStorage.js'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import HubSourceRowBody from './HubSourceRowBody.svelte'
  import {
    sourceKindLabel,
    type HubRipmailSourceRow,
  } from '@client/lib/hub/hubRipmailSource.js'

  type Props = {
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    /** When settings detail shows this hub connection (`overlay.type === 'hub-source'`), highlight its row. */
    selectedHubSourceId?: string
    /** After accepting a share, open the shared wiki in the main shell. */
    onNavigateToSharedWiki?: (_p: {
      ownerId: string
      ownerHandle: string
      pathPrefix: string
      targetKind: 'dir' | 'file'
    }) => void
  }

  let { onSettingsNavigate, selectedHubSourceId, onNavigateToSharedWiki }: Props = $props()

  let hubSources = $state<HubRipmailSourceRow[]>([])
  let hubSourcesError = $state<string | null>(null)
  let mailHiddenFromDefault = $state<Set<string>>(new Set())
  let defaultSendSourceId = $state<string | null>(null)
  let addAccountBanner = $state<{ kind: 'ok' | 'err'; message: string } | null>(null)
  let multiTenant = $state(false)
  let hostedWorkspaceHandle = $state<string | undefined>(undefined)
  let accountBusy = $state(false)
  let deleteAllConfirmOpen = $state(false)
  let chatToolDisplayMode = $state<ChatToolDisplayMode>(readChatToolDisplayPreference())

  let shareOwned = $state<WikiShareApiRow[]>([])
  let shareReceived = $state<WikiShareApiRow[]>([])
  let sharePending = $state<WikiShareApiRow[]>([])
  let shareLoadError = $state<string | null>(null)
  let shareAcceptBusyId = $state<string | null>(null)
  let shareRevokeBusyId = $state<string | null>(null)

  function onChatToolDisplayPrefChange(mode: ChatToolDisplayMode) {
    chatToolDisplayMode = mode
    writeChatToolDisplayPreference(mode)
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
    if (kind === 'localDir' || kind === 'googleDrive') return 2
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
      const [sourcesRes, mailPrefsRes] = await Promise.all([
        fetch('/api/hub/sources'),
        fetch('/api/hub/sources/mail-prefs'),
      ])
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
    } catch {
      /* ignore */
    }
  }

  /**
   * After OAuth link callback redirects to `/settings?addedAccount=…`, show a banner and strip query params.
   */
  function consumeAddAccountQuery() {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.pathname !== '/settings') return
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

  async function loadWikiShares() {
    shareLoadError = null
    try {
      const data = await fetchWikiSharesList()
      if (!data) {
        shareLoadError = 'Could not load sharing.'
        return
      }
      shareOwned = data.owned ?? []
      shareReceived = data.received ?? []
      sharePending = data.pendingReceived ?? []
    } catch {
      shareLoadError = 'Could not load sharing.'
    }
  }

  function scrollSettingsSharingHash() {
    if (typeof location === 'undefined' || location.hash !== '#sharing') return
    queueMicrotask(() => {
      document
        .getElementById('settings-sharing')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  async function acceptPendingShare(row: WikiShareApiRow) {
    if (shareAcceptBusyId) return
    shareAcceptBusyId = row.id
    try {
      const res = await fetch(`/api/wiki-shares/${encodeURIComponent(row.id)}/accept`, { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        ownerId?: string
        ownerHandle?: string
        pathPrefix?: string
        targetKind?: 'dir' | 'file'
        error?: string
        message?: string
      }
      if (!res.ok || !j.ok || typeof j.ownerId !== 'string') {
        shareLoadError = j.message ?? j.error ?? 'Could not accept invite.'
        return
      }
      onNavigateToSharedWiki?.({
        ownerId: j.ownerId,
        ownerHandle: typeof j.ownerHandle === 'string' ? j.ownerHandle : row.ownerHandle,
        pathPrefix: typeof j.pathPrefix === 'string' ? j.pathPrefix : row.pathPrefix,
        targetKind: j.targetKind === 'file' ? 'file' : 'dir',
      })
      await loadWikiShares()
      emit({ type: 'wiki-shares-changed' })
    } finally {
      shareAcceptBusyId = null
    }
  }

  async function revokeOwnedShare(row: WikiShareApiRow) {
    if (shareRevokeBusyId) return
    shareRevokeBusyId = row.id
    try {
      const res = await fetch(`/api/wiki-shares/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        shareLoadError = 'Could not revoke share.'
        return
      }
      await loadWikiShares()
      emit({ type: 'wiki-shares-changed' })
    } finally {
      shareRevokeBusyId = null
    }
  }

  function openReceivedShare(row: WikiShareApiRow) {
    onNavigateToSharedWiki?.({
      ownerId: row.ownerId,
      ownerHandle: row.ownerHandle,
      pathPrefix: row.pathPrefix,
      targetKind: row.targetKind,
    })
  }

  function sharePathLabel(row: WikiShareApiRow): string {
    const p = row.pathPrefix.trim().replace(/\\/g, '/')
    if (row.targetKind === 'file') return p
    return p.endsWith('/') ? p.slice(0, -1) || '(wiki root)' : p
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
    void loadWikiShares()
    scrollSettingsSharingHash()
    const onHashChange = () => scrollSettingsSharingHash()
    window.addEventListener('hashchange', onHashChange)
    const unsub = subscribe((e) => {
      if (e.type === 'hub:sources-changed' || e.type === 'sync:completed') void fetchData()
      if (e.type === 'wiki-shares-changed') void loadWikiShares()
    })
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      unsub()
    }
  })

  async function onLogout() {
    if (accountBusy) return
    accountBusy = true
    try {
      await postVaultLogout()
      clearBrainClientStorage()
      window.location.assign('/c')
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
      window.location.assign('/c')
    } finally {
      accountBusy = false
    }
  }
</script>

<div class="settings-page">
  <header class="settings-header">
    <div class="settings-title-block">
      <h1>Settings</h1>
      <p class="settings-subtitle">Your workspace, connections, and preferences.</p>
      {#if hostedWorkspaceHandle}
        <p class="settings-handle" translate="no">@{hostedWorkspaceHandle}</p>
      {/if}
    </div>
  </header>

  {#if addAccountBanner}
    <div
      class="settings-banner"
      class:settings-banner--err={addAccountBanner.kind === 'err'}
      role={addAccountBanner.kind === 'err' ? 'alert' : 'status'}
    >
      {addAccountBanner.message}
      <button
        type="button"
        class="settings-banner-dismiss"
        aria-label="Dismiss"
        onclick={() => (addAccountBanner = null)}
      >×</button>
    </div>
  {/if}

  <div class="settings-grid">
    <section class="settings-section" aria-labelledby="settings-account-heading" aria-busy={accountBusy}>
      <div class="section-header">
        <User size={18} />
        <h2 id="settings-account-heading">Account</h2>
      </div>
      <div class="links-list">
        <button
          type="button"
          class="link-item"
          onclick={() => onSettingsNavigate({ type: 'wiki', path: 'me.md' })}
        >
          <div class="link-info">
            <User size={16} />
            <span>Your profile</span>
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
              <span class="settings-delete-wrap" aria-hidden="true"><Trash2 size={16} /></span>
              <span>Delete all my data</span>
            </div>
            <div class="link-status">
              <span class="status-sub">Removes wiki, index, chats</span>
            </div>
            <ChevronRight size={16} />
          </button>
        {/if}
      </div>
    </section>

    <section class="settings-section" aria-labelledby="settings-sources-heading">
      <div class="section-header">
        <Link2 size={18} />
        <h2 id="settings-sources-heading">Connections</h2>
      </div>
      <p class="section-lead">
        Mailboxes, calendars, and folders wired into Braintunnel. Open a row to change indexing, default send, or remove
        a connection.
      </p>
      <div class="links-list">
        {#if hubSourcesError}
          <p class="empty-msg settings-sources-err" title={hubSourcesError}>Could not load sources.</p>
        {:else if orderedHubSources.length === 0}
          <p class="empty-msg">
            {#if multiTenant}
              No sources yet. Connect mail or add calendars below.
            {:else}
              No sources yet. Connect mail or add calendars.
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
              class:link-item--selected={selectedHubSourceId === s.id}
              aria-current={selectedHubSourceId === s.id ? 'true' : undefined}
              onclick={() => onSettingsNavigate({ type: 'hub-source', id: s.id })}
            >
              <div class="link-info">
                <HubSourceRowBody title={s.displayName} subtitle={sourceRowSecondary(s)}>
                  {#snippet icon()}
                    {#if s.kind === 'localDir'}
                      <Folder size={16} />
                    {:else if s.kind === 'googleDrive'}
                      <HardDrive size={16} />
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
        <button type="button" class="link-item hub-source-row" onclick={startAddAnotherGmail}>
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
      </div>
    </section>

    <section id="settings-sharing" class="settings-section" aria-labelledby="settings-sharing-heading">
      <div class="section-header">
        <Share2 size={18} />
        <h2 id="settings-sharing-heading">Sharing</h2>
      </div>
      <p class="section-lead">
        Accept read-only wiki invites from others and manage what you have shared. Invites match your
        <strong>primary mailbox email</strong> from Connections above.
      </p>
      {#if shareLoadError}
        <p class="empty-msg settings-sharing-err" role="alert">{shareLoadError}</p>
      {/if}

      {#if sharePending.length > 0}
        <div class="settings-share-block">
          <h3 class="settings-share-subhead">Invitations</h3>
          <ul class="settings-share-list">
            {#each sharePending as row (row.id)}
              <li class="settings-share-row">
                <div class="settings-share-main">
                  <span class="settings-share-path" translate="no"><code>{sharePathLabel(row)}</code></span>
                  <span class="settings-share-meta">From @{row.ownerHandle} · {row.granteeEmail}</span>
                </div>
                <button
                  type="button"
                  class="settings-share-btn settings-share-btn-primary"
                  disabled={shareAcceptBusyId !== null}
                  onclick={() => void acceptPendingShare(row)}
                >
                  {shareAcceptBusyId === row.id ? 'Accepting…' : 'Accept'}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="settings-share-block">
        <h3 class="settings-share-subhead">Shared with you</h3>
        {#if shareReceived.length === 0}
          <p class="empty-msg settings-share-empty">No active shared wikis yet.</p>
        {:else}
          <ul class="settings-share-list">
            {#each shareReceived as row (row.id)}
              <li class="settings-share-row">
                <div class="settings-share-main">
                  <span class="settings-share-path" translate="no"><code>{sharePathLabel(row)}</code></span>
                  <span class="settings-share-meta">@{row.ownerHandle}</span>
                </div>
                <button type="button" class="settings-share-btn" onclick={() => openReceivedShare(row)}>
                  Open
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="settings-share-block">
        <h3 class="settings-share-subhead">What you’ve shared</h3>
        {#if shareOwned.length === 0}
          <p class="empty-msg settings-share-empty">You have not shared any wiki paths yet.</p>
        {:else}
          <ul class="settings-share-list">
            {#each shareOwned as row (row.id)}
              <li class="settings-share-row">
                <div class="settings-share-main">
                  <span class="settings-share-path" translate="no"><code>{sharePathLabel(row)}</code></span>
                  <span class="settings-share-meta">
                    → {row.granteeEmail}
                    {#if row.granteeId}
                      <span class="settings-share-pill">Active</span>
                    {:else}
                      <span class="settings-share-pill settings-share-pill-muted">Pending</span>
                    {/if}
                  </span>
                </div>
                <button
                  type="button"
                  class="settings-share-btn settings-share-btn-danger"
                  disabled={shareRevokeBusyId !== null}
                  onclick={() => void revokeOwnedShare(row)}
                >
                  {shareRevokeBusyId === row.id ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </section>

    <section class="settings-section" aria-labelledby="settings-chat-prefs-heading">
      <div class="section-header">
        <MessageSquare size={18} />
        <h2 id="settings-chat-prefs-heading">Chat</h2>
      </div>
      <p class="section-lead" id="settings-chat-tool-display-desc">
        How assistant tool use appears in your message history.
      </p>
      <div
        class="settings-chat-pref-section"
        role="radiogroup"
        aria-labelledby="settings-chat-tool-display-desc"
      >
        <label class="settings-chat-pref-row">
          <input
            type="radio"
            name="settings-chat-tool-display"
            value="compact"
            checked={chatToolDisplayMode === 'compact'}
            onchange={() => onChatToolDisplayPrefChange('compact')}
          />
          <span class="settings-chat-pref-text">
            <span class="settings-chat-pref-title">Compact</span>
            <span class="settings-chat-pref-sub">One-line summary per tool in the transcript.</span>
          </span>
        </label>
        <label class="settings-chat-pref-row">
          <input
            type="radio"
            name="settings-chat-tool-display"
            value="detailed"
            checked={chatToolDisplayMode === 'detailed'}
            onchange={() => onChatToolDisplayPrefChange('detailed')}
          />
          <span class="settings-chat-pref-text">
            <span class="settings-chat-pref-title">Detailed</span>
            <span class="settings-chat-pref-sub">
              Expandable arguments, results, and previews inline for each tool.
            </span>
          </span>
        </label>
      </div>
    </section>
  </div>
</div>

<ConfirmDialog
  open={deleteAllConfirmOpen}
  title="Delete all your data?"
  titleId="settings-delete-all-title"
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
      This permanently removes your wiki, chats, and profile from Braintunnel, plus the search library Braintunnel built
      from your mail and other sources. You can't undo it.
    </p>
    <p>
      Your email accounts stay as they are: Braintunnel doesn't change or delete messages at your provider, and you can
      keep using mail the same way you do today.
    </p>
  {/snippet}
</ConfirmDialog>

<style>
  .settings-page {
    padding: 2.5rem 2rem;
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 2rem;
    color: var(--text);
  }

  .settings-header {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .settings-title-block h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .settings-subtitle {
    margin: 0.5rem 0 0;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--text-2);
    max-width: 36rem;
  }

  .settings-handle {
    margin: 0.35rem 0 0;
    font-size: 0.9375rem;
    font-family: ui-monospace, monospace;
    color: var(--text-2);
  }

  .settings-banner {
    margin: 0;
    padding: 0.75rem 2.5rem 0.75rem 1rem;
    border-radius: 8px;
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-2));
    color: var(--text);
    font-size: 0.9375rem;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    position: relative;
  }

  .settings-banner--err {
    background: color-mix(in srgb, var(--danger) 12%, var(--bg-2));
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    color: var(--text);
  }

  .settings-banner-dismiss {
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

  .settings-banner-dismiss:hover {
    color: var(--text);
  }

  .settings-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 3.5rem;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
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

  .section-lead {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    line-height: 1.45;
    max-width: 40rem;
  }

  .settings-chat-pref-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .settings-chat-pref-row {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.45rem 0;
    cursor: pointer;
  }

  .settings-chat-pref-row input[type='radio'] {
    margin-top: 0.2rem;
    flex-shrink: 0;
    accent-color: var(--accent);
  }

  .settings-chat-pref-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .settings-chat-pref-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
  }

  .settings-chat-pref-sub {
    font-size: 0.8125rem;
    color: var(--text-2);
    line-height: 1.4;
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

  .links-list {
    display: flex;
    flex-direction: column;
  }

  .link-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    background: transparent;
    /* Uniform border keeps row height stable; color shows selection/focus flush with fill */
    border: 1px solid transparent;
    border-bottom-color: color-mix(in srgb, var(--border) 40%, transparent);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition:
      padding-left 0.2s ease,
      color 0.15s,
      background 0.12s ease,
      border-color 0.12s ease;
  }

  .link-item:focus-visible:not(:disabled) {
    background: var(--accent-dim);
    outline: none;
    border-color: var(--accent);
    border-bottom-color: var(--accent);
  }

  /** Matches open hub-source detail (`selectedHubSourceId`) — not focus-only. */
  .link-item.link-item--selected:not(:disabled) {
    background: var(--accent-dim);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    border-bottom-color: color-mix(in srgb, var(--accent) 45%, transparent);
  }

  .link-item.link-item--selected:not(:disabled):focus-visible {
    border-color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .link-item:disabled {
    opacity: 0.55;
    cursor: not-allowed;
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

  .settings-delete-wrap {
    display: flex;
    flex-shrink: 0;
    color: var(--danger);
  }

  .settings-delete-wrap :global(svg) {
    stroke: currentColor;
  }

  .empty-msg {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-2);
    padding: 1rem 0;
  }

  .settings-sources-err {
    cursor: help;
  }

  .settings-sharing-err {
    color: var(--text);
  }

  .settings-share-block {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .settings-share-subhead {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--text-2);
    text-transform: uppercase;
  }

  .settings-share-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .settings-share-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.65rem 0.75rem;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--border) 85%, transparent);
    background: var(--bg-2);
  }

  .settings-share-main {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    min-width: 0;
  }

  .settings-share-path code {
    font-size: 0.8125rem;
    word-break: break-all;
  }

  .settings-share-meta {
    font-size: 0.75rem;
    color: var(--text-2);
  }

  .settings-share-pill {
    display: inline-block;
    margin-left: 0.35rem;
    font-size: 0.625rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-2));
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .settings-share-pill-muted {
    background: var(--bg-3);
    color: var(--text-2);
  }

  .settings-share-btn {
    flex-shrink: 0;
    padding: 0.35rem 0.65rem;
    font-size: 0.8125rem;
    font-weight: 600;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-3);
    color: var(--text);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }

  .settings-share-btn:hover:not(:disabled) {
    background: var(--bg);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }

  .settings-share-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .settings-share-btn-primary {
    background: color-mix(in srgb, var(--accent) 16%, var(--bg-2));
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    color: var(--text);
  }

  .settings-share-btn-primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 24%, var(--bg-2));
  }

  .settings-share-btn-danger {
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);
    color: var(--danger);
  }

  .settings-share-btn-danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--danger) 10%, var(--bg-2));
  }

  .settings-share-empty {
    padding: 0.5rem 0;
  }

  @media (max-width: 767px) {
    .settings-page {
      padding: 1.5rem 1rem;
    }
  }
</style>
