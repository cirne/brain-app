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
  } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
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
  import ConfirmDialog from '@tw-components/ConfirmDialog.svelte'
  import HubSourceRowBody from '@tw-components/HubSourceRowBody.svelte'
  import {
    sourceKindLabel,
    type HubRipmailSourceRow,
  } from '@client/lib/hub/hubRipmailSource.js'

  type Props = {
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    /** When settings detail shows this hub connection (`overlay.type === 'hub-source'`), highlight its row. */
    selectedHubSourceId?: string
  }

  let { onSettingsNavigate, selectedHubSourceId }: Props = $props()

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
    return subscribe((e) => {
      if (e.type === 'hub:sources-changed' || e.type === 'sync:completed') void fetchData()
    })
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

  /** Section header. */
  const sectionHeaderBase =
    'section-header flex items-center gap-3 border-b border-border pb-3 text-foreground'
  /**
   * Settings link rows. Border-1 transparent gives stable row height; only the color changes
   * on selection/focus so the fill sits flush with the row.
   */
  const linkItemBase =
    'link-item flex cursor-pointer items-center justify-between border border-transparent border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-transparent p-2 text-left text-foreground transition-[padding,color,background,border-color] duration-150 focus-visible:!border-accent focus-visible:bg-accent-dim focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55'
  const linkItemSelected =
    'link-item--selected !border-[color-mix(in_srgb,var(--accent)_45%,transparent)] !bg-accent-dim focus-visible:!border-accent'
</script>

<div
  class="settings-page mx-auto flex w-full max-w-[900px] flex-col gap-8 px-8 py-10 text-foreground max-md:px-4 max-md:py-6"
>
  <header class="settings-header flex flex-col gap-3 border-b border-border pb-4">
    <div class="settings-title-block">
      <h1 class="m-0 text-[2rem] font-extrabold tracking-[-0.02em]">Settings</h1>
      <p class="settings-subtitle m-0 mt-2 max-w-[36rem] text-[0.9375rem] leading-[1.45] text-muted">
        Your workspace, connections, and preferences.
      </p>
      {#if hostedWorkspaceHandle}
        <p
          class="settings-handle m-0 mt-[0.35rem] font-mono text-[0.9375rem] text-muted"
          translate="no"
        >@{hostedWorkspaceHandle}</p>
      {/if}
    </div>
  </header>

  {#if addAccountBanner}
    <div
      class={cn(
        'settings-banner relative m-0 rounded-lg border bg-[color-mix(in_srgb,var(--accent)_14%,var(--bg-2))] border-[color-mix(in_srgb,var(--accent)_35%,transparent)] py-3 pl-4 pr-10 text-[0.9375rem] text-foreground',
        addAccountBanner.kind === 'err' &&
          'settings-banner--err border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,var(--bg-2))]',
      )}
      role={addAccountBanner.kind === 'err' ? 'alert' : 'status'}
    >
      {addAccountBanner.message}
      <button
        type="button"
        class="settings-banner-dismiss absolute right-2 top-[0.35rem] cursor-pointer rounded-md border-none bg-transparent px-[0.4rem] py-[0.15rem] text-xl leading-none text-muted hover:text-foreground"
        aria-label="Dismiss"
        onclick={() => (addAccountBanner = null)}
      >×</button>
    </div>
  {/if}

  <div class="settings-grid grid grid-cols-1 gap-14">
    <section
      class="settings-section flex flex-col gap-6"
      aria-labelledby="settings-account-heading"
      aria-busy={accountBusy}
    >
      <div class={sectionHeaderBase}>
        <User size={18} />
        <h2 id="settings-account-heading" class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">Account</h2>
      </div>
      <div class="links-list flex flex-col">
        <button
          type="button"
          class={linkItemBase}
          onclick={() => onSettingsNavigate({ type: 'wiki', path: 'me.md' })}
        >
          <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
            <User size={16} />
            <span>Your profile</span>
          </div>
          <ChevronRight size={16} />
        </button>

        {#if multiTenant}
          <button type="button" class={linkItemBase} onclick={onLogout} disabled={accountBusy}>
            <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
              <LogOut size={16} />
              <span>Sign out</span>
            </div>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            class={linkItemBase}
            onclick={openDeleteAllConfirm}
            disabled={accountBusy}
          >
            <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
              <span
                class="settings-delete-wrap flex shrink-0 text-danger [&_svg]:stroke-current"
                aria-hidden="true"
              ><Trash2 size={16} /></span>
              <span>Delete all my data</span>
            </div>
            <div class="link-status flex flex-col items-end gap-px">
              <span class="status-sub text-xs text-muted">Removes wiki, index, chats</span>
            </div>
            <ChevronRight size={16} />
          </button>
        {/if}
      </div>
    </section>

    <section class="settings-section flex flex-col gap-6" aria-labelledby="settings-sources-heading">
      <div class={sectionHeaderBase}>
        <Link2 size={18} />
        <h2 id="settings-sources-heading" class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">Connections</h2>
      </div>
      <p class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-[1.45] text-muted">
        Mailboxes, calendars, and folders wired into Braintunnel. Open a row to change indexing, default send, or remove
        a connection.
      </p>
      <div class="links-list flex flex-col">
        {#if hubSourcesError}
          <p class="empty-msg settings-sources-err m-0 cursor-help py-4 text-[0.9375rem] text-muted" title={hubSourcesError}>Could not load sources.</p>
        {:else if orderedHubSources.length === 0}
          <p class="empty-msg m-0 py-4 text-[0.9375rem] text-muted">
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
              class={cn(
                linkItemBase,
                'hub-source-row',
                selectedHubSourceId === s.id && linkItemSelected,
              )}
              aria-current={selectedHubSourceId === s.id ? 'true' : undefined}
              onclick={() => onSettingsNavigate({ type: 'hub-source', id: s.id })}
            >
              <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
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
              <div
                class="hub-source-row-flags mr-2 inline-flex shrink-0 items-center gap-1.5"
                aria-hidden={!isMail}
              >
                {#if isDefaultSend}
                  <span
                    class="hub-source-pill hub-source-pill--send whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_18%,var(--bg-2))] px-2 py-px text-[0.625rem] font-bold uppercase tracking-[0.04em] text-[color-mix(in_srgb,var(--accent)_92%,var(--text))]"
                    title="Default mailbox for sending"
                  >
                    Default send
                  </span>
                {/if}
                {#if isHidden}
                  <span
                    class="hub-source-pill hub-source-pill--hidden whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-2 py-px text-[0.625rem] font-bold uppercase tracking-[0.04em] text-muted"
                    title="Excluded from default searches"
                  >
                    Hidden from search
                  </span>
                {/if}
              </div>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          {/each}
        {/if}
        <button type="button" class={cn(linkItemBase, 'hub-source-row')} onclick={startAddAnotherGmail}>
          <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
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

    <section class="settings-section flex flex-col gap-6" aria-labelledby="settings-chat-prefs-heading">
      <div class={sectionHeaderBase}>
        <MessageSquare size={18} />
        <h2 id="settings-chat-prefs-heading" class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">Chat</h2>
      </div>
      <p class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-[1.45] text-muted" id="settings-chat-tool-display-desc">
        How assistant tool use appears in your message history.
      </p>
      <div
        class="settings-chat-pref-section flex flex-col gap-[0.6rem]"
        role="radiogroup"
        aria-labelledby="settings-chat-tool-display-desc"
      >
        <label class="settings-chat-pref-row flex cursor-pointer items-start gap-[0.6rem] py-[0.45rem]">
          <input
            type="radio"
            name="settings-chat-tool-display"
            value="compact"
            class="mt-[0.2rem] shrink-0 accent-accent"
            checked={chatToolDisplayMode === 'compact'}
            onchange={() => onChatToolDisplayPrefChange('compact')}
          />
          <span class="settings-chat-pref-text flex flex-col gap-[0.15rem]">
            <span class="settings-chat-pref-title text-sm font-semibold leading-[1.3] text-foreground">Compact</span>
            <span class="settings-chat-pref-sub text-[0.8125rem] leading-[1.4] text-muted">One-line summary per tool in the transcript.</span>
          </span>
        </label>
        <label class="settings-chat-pref-row flex cursor-pointer items-start gap-[0.6rem] py-[0.45rem]">
          <input
            type="radio"
            name="settings-chat-tool-display"
            value="detailed"
            class="mt-[0.2rem] shrink-0 accent-accent"
            checked={chatToolDisplayMode === 'detailed'}
            onchange={() => onChatToolDisplayPrefChange('detailed')}
          />
          <span class="settings-chat-pref-text flex flex-col gap-[0.15rem]">
            <span class="settings-chat-pref-title text-sm font-semibold leading-[1.3] text-foreground">Detailed</span>
            <span class="settings-chat-pref-sub text-[0.8125rem] leading-[1.4] text-muted">
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
  <p>
    This permanently removes your wiki, chats, and profile from Braintunnel, plus the search library Braintunnel built
    from your mail and other sources. You can't undo it.
  </p>
  <p>
    Your email accounts stay as they are: Braintunnel doesn't change or delete messages at your provider, and you can
    keep using mail the same way you do today.
  </p>
</ConfirmDialog>
