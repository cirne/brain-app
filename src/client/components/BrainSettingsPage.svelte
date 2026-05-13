<script lang="ts">
  import { onMount } from 'svelte'
  import {
    User,
    ChevronRight,
    LogOut,
    Trash2,
    MessageSquare,
    Link2,
    Brain,
    BookOpen,
  } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import type { OnboardingMailStatus } from '@client/lib/onboarding/onboardingTypes.js'
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
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import HubSourceRowBody from '@components/HubSourceRowBody.svelte'
  import HubActivityOverview from '@components/hub/HubActivityOverview.svelte'
  import SettingsSectionH2 from '@components/settings/SettingsSectionH2.svelte'
  import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
  import { postYourWikiPause, postYourWikiResume, postYourWikiRunLap } from '@client/lib/yourWikiLoopApi.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'
  import { onboardingMailStatusFromBackground } from '@client/lib/hub/backgroundStatusMap.js'
  import { startHubEventsConnection } from '@client/lib/hubEvents/hubEventsClient.js'
  import { HUB_BACKGROUND_STATUS_POLL_MS } from '@client/lib/hub/hubBackgroundPoll.js'
  import { sortHubRipmailSources } from '@client/lib/hub/hubSourceOrdering.js'
  import { indexFeedSummaryFromHubSources } from '@client/lib/hub/indexFeedSummary.js'
  import { buildInitialYourWikiDocFromWikiSlice } from '@client/lib/hub/yourWikiDocFromBackground.js'
  import { wikiOverviewSubtitle, wikiOverviewTitle } from '@client/lib/hub/wikiOverviewCopy.js'
  import type { HubRipmailSourceRow } from '@client/lib/hub/hubRipmailSource.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    selectedHubSourceId?: string
    brainQueryEnabled?: boolean
    multiTenant?: boolean
  }

  let {
    onSettingsNavigate,
    selectedHubSourceId: _selectedHubSourceId,
    brainQueryEnabled = false,
    multiTenant = false,
  }: Props = $props()

  let docCount = $state<number | null>(null)
  let wikiDoc = $state<BackgroundAgentDoc | null>(null)
  let mailStatus = $state<OnboardingMailStatus | null>(null)
  let hubSources = $state<HubRipmailSourceRow[]>([])
  let hubSourcesError = $state<string | null>(null)
  let hostedWorkspaceHandle = $state<string | undefined>(undefined)
  let wikiActionBusy = $state(false)
  let backgroundStatusLoading = $state(true)
  let syncKickBusy = $state(false)
  let wikiBackgroundUpdateBusy = $state(false)

  let addAccountBanner = $state<{ kind: 'ok' | 'err'; message: string } | null>(null)
  let accountBusy = $state(false)
  let deleteAllConfirmOpen = $state(false)
  let chatToolDisplayMode = $state<ChatToolDisplayMode>(readChatToolDisplayPreference())

  function onChatToolDisplayPrefChange(mode: ChatToolDisplayMode) {
    chatToolDisplayMode = mode
    writeChatToolDisplayPreference(mode)
  }

  const wikiPhase = $derived(wikiDoc?.phase as YourWikiPhase | undefined)
  const wikiIsActive = $derived(
    wikiPhase === 'starting' || wikiPhase === 'enriching' || wikiPhase === 'cleaning',
  )
  const wikiIsPaused = $derived(wikiPhase === 'paused')
  const wikiIsIdle = $derived(
    wikiPhase === 'idle' ||
      (!wikiIsActive && wikiPhase !== 'paused' && wikiPhase !== 'error'),
  )

  const wikiPageCount = $derived(wikiDoc != null ? wikiDoc.pageCount : docCount)

  const wikiHubTitle = $derived(wikiOverviewTitle(wikiDoc))
  const wikiHubSub = $derived(wikiOverviewSubtitle(wikiDoc, wikiPageCount))

  const orderedHubSources = $derived(sortHubRipmailSources(hubSources))

  function applyBackgroundStatusPayload(bg: BackgroundStatusResponse): void {
    mailStatus = onboardingMailStatusFromBackground(bg.mail)
    if (wikiDoc == null && bg.wiki) {
      wikiDoc = buildInitialYourWikiDocFromWikiSlice(bg.wiki, bg.updatedAt)
    }
  }

  async function refreshBackgroundStatusPoll(): Promise<void> {
    try {
      const bgRes = await fetch('/api/background-status', { credentials: 'include' })
      if (!bgRes.ok) return
      const bg = (await bgRes.json()) as BackgroundStatusResponse
      applyBackgroundStatusPayload(bg)
    } catch {
      /* ignore */
    }
  }

  const indexFeedSummary = $derived(indexFeedSummaryFromHubSources(orderedHubSources))

  async function fetchData() {
    backgroundStatusLoading = true
    try {
      const [wikiRes, bgRes, sourcesRes] = await Promise.all([
        fetch('/api/wiki', { credentials: 'include' }),
        fetch('/api/background-status', { credentials: 'include' }),
        fetch('/api/hub/sources', { credentials: 'include' }),
      ])

      if (wikiRes.ok) {
        docCount = parseWikiListApiBody(await wikiRes.json()).files.length
      }
      if (bgRes.ok) {
        applyBackgroundStatusPayload((await bgRes.json()) as BackgroundStatusResponse)
      }
      if (sourcesRes.ok) {
        const j = (await sourcesRes.json()) as { sources?: HubRipmailSourceRow[]; error?: string }
        hubSources = Array.isArray(j.sources) ? j.sources : []
        hubSourcesError = typeof j.error === 'string' && j.error.trim() ? j.error : null
      }
    } catch {
      /* ignore */
    } finally {
      backgroundStatusLoading = false
    }
  }

  async function syncMailNow() {
    if (syncKickBusy || mailStatus?.syncRunning) return
    syncKickBusy = true
    try {
      await fetch('/api/inbox/sync', { method: 'POST', credentials: 'include' })
      await fetchData()
    } finally {
      syncKickBusy = false
    }
  }

  async function runWikiBackgroundUpdateNow() {
    if (wikiBackgroundUpdateBusy) return
    wikiBackgroundUpdateBusy = true
    try {
      await postYourWikiRunLap()
      await fetchData()
    } finally {
      wikiBackgroundUpdateBusy = false
    }
  }

  async function wikiPause() {
    if (wikiActionBusy) return
    wikiActionBusy = true
    try {
      await postYourWikiPause()
    } finally {
      wikiActionBusy = false
    }
  }

  async function wikiResume() {
    if (wikiActionBusy) return
    wikiActionBusy = true
    try {
      await postYourWikiResume()
    } finally {
      wikiActionBusy = false
    }
  }

  function consumeAddAccountQuery() {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.pathname !== '/settings') return
    const ok = url.searchParams.get('addedAccount')
    const err = url.searchParams.get('addAccountError')
    if (!ok && !err) return
    if (ok) {
      addAccountBanner = {
        kind: 'ok',
        message: $t('settings.brainSettingsPage.addAccountBanner.added', { mailbox: ok }),
      }
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

  onMount(() => {
    void fetchVaultStatus()
      .then((v) => {
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
        hostedWorkspaceHandle = undefined
      })
    consumeAddAccountQuery()
    void fetchData()
    const pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refreshBackgroundStatusPoll()
    }, HUB_BACKGROUND_STATUS_POLL_MS)
    const unsubEvents = subscribe((e) => {
      if (e.type === 'hub:sources-changed' || e.type === 'wiki:mutated' || e.type === 'sync:completed') {
        void fetchData()
      }
    })
    const unsubWikiStore = yourWikiDocFromEvents.subscribe((doc) => {
      if (doc) wikiDoc = doc
    })
    const stopHubEvents = startHubEventsConnection()
    return () => {
      clearInterval(pollTimer)
      unsubEvents()
      unsubWikiStore()
      stopHubEvents()
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

  const linkItemBase =
    'link-item flex cursor-pointer items-center justify-between border border-transparent border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-transparent p-2 text-left text-foreground transition-[padding,color,background,border-color] duration-150 focus-visible:!border-accent focus-visible:bg-accent-dim focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55'
  const drillRowBase =
    'link-item flex cursor-pointer items-center justify-between border border-transparent border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-transparent py-2 text-left text-foreground transition-[padding,color] duration-150 hover:not-disabled:pl-1 hover:not-disabled:text-accent'
</script>

<div
  class="settings-page mx-auto flex w-full max-w-[900px] flex-col gap-8 px-8 py-10 text-foreground max-md:px-4 max-md:py-6"
>
  <header class="settings-header flex flex-col gap-3 border-b border-border pb-4">
    <div class="settings-title-block">
      <h1 class="m-0 text-[2rem] font-extrabold tracking-[-0.02em]">
        {$t('settings.brainSettingsPage.title')}
      </h1>
      <p class="settings-subtitle m-0 mt-2 max-w-[36rem] text-[0.9375rem] leading-[1.45] text-muted">
        {$t('settings.brainSettingsPage.subtitle')}
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
        'settings-banner relative m-0 border bg-[color-mix(in_srgb,var(--accent)_14%,var(--bg-2))] border-[color-mix(in_srgb,var(--accent)_35%,transparent)] py-3 pl-4 pr-10 text-[0.9375rem] text-foreground',
        addAccountBanner.kind === 'err' &&
          'settings-banner--err border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--danger)_12%,var(--bg-2))]',
      )}
      role={addAccountBanner.kind === 'err' ? 'alert' : 'status'}
    >
      {addAccountBanner.message}
      <button
        type="button"
        class="settings-banner-dismiss absolute right-2 top-[0.35rem] cursor-pointer border-none bg-transparent px-[0.4rem] py-[0.15rem] text-xl leading-none text-muted hover:text-foreground"
        aria-label={$t('settings.brainSettingsPage.dismiss')}
        onclick={() => (addAccountBanner = null)}
      >×</button>
    </div>
  {/if}

  <HubActivityOverview
    mailStatus={mailStatus}
    mailLoading={backgroundStatusLoading}
    wikiTitle={wikiHubTitle}
    wikiSubtitle={wikiHubSub}
    wikiPhase={wikiPhase}
    wikiIsActive={wikiIsActive}
    wikiIsPaused={wikiIsPaused}
    wikiIsIdle={wikiIsIdle}
    showWikiControls={Boolean(wikiDoc && wikiPhase != null)}
    onSyncNow={syncMailNow}
    onWikiUpdateNow={runWikiBackgroundUpdateNow}
    onPause={wikiPause}
    onResume={wikiResume}
    syncBusy={syncKickBusy || Boolean(mailStatus?.syncRunning)}
    wikiUpdateBusy={wikiBackgroundUpdateBusy}
    wikiActionBusy={wikiActionBusy}
    indexFeedSummary={indexFeedSummary}
    sourcesEmpty={orderedHubSources.length === 0}
    sourcesError={hubSourcesError}
    onOpenSettings={() => onSettingsNavigate({ type: 'settings-connections' })}
  />

  <div class="settings-grid grid grid-cols-1 gap-14">
    <section class="settings-section flex flex-col gap-6" aria-labelledby="settings-drill-heading">
      <SettingsSectionH2 label={$t('settings.brainSettingsPage.sections.workspace')} id="settings-drill-heading" />
      <div class="links-list flex flex-col">
        <button
          type="button"
          class={drillRowBase}
          onclick={() => onSettingsNavigate({ type: 'settings-connections' })}
        >
          <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
            <Link2 size={16} aria-hidden="true" />
            <HubSourceRowBody
              title={$t('settings.brainSettingsPage.workspace.connections.title')}
              subtitle={$t('settings.brainSettingsPage.workspace.connections.subtitle')}
            />
          </div>
          <ChevronRight size={16} aria-hidden="true" />
        </button>

        <button
          type="button"
          class={drillRowBase}
          onclick={() => onSettingsNavigate({ type: 'settings-wiki' })}
        >
          <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
            <BookOpen size={16} aria-hidden="true" />
            <HubSourceRowBody
              title={$t('settings.brainSettingsPage.workspace.wikiActivity.title')}
              subtitle={$t('settings.brainSettingsPage.workspace.wikiActivity.subtitle')}
            />
          </div>
          <ChevronRight size={16} aria-hidden="true" />
        </button>

        {#if brainQueryEnabled}
          <button
            type="button"
            class={drillRowBase}
            onclick={() => onSettingsNavigate({ type: 'brain-access' })}
          >
            <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
              <Brain size={16} aria-hidden="true" />
              <HubSourceRowBody
                title={$t('settings.brainSettingsPage.workspace.brainAccess.title')}
                subtitle={$t('settings.brainSettingsPage.workspace.brainAccess.subtitle')}
              />
            </div>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        {/if}
      </div>
    </section>

    <section
      class="settings-section flex flex-col gap-6"
      aria-labelledby="settings-account-heading"
      aria-busy={accountBusy}
    >
      <SettingsSectionH2 label={$t('settings.brainSettingsPage.sections.account')} id="settings-account-heading">
        {#snippet icon()}
          <User size={18} aria-hidden="true" />
        {/snippet}
      </SettingsSectionH2>
      <div class="links-list flex flex-col">
        <button
          type="button"
          class={linkItemBase}
          onclick={() => onSettingsNavigate({ type: 'wiki', path: 'me.md' })}
        >
          <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
            <User size={16} />
            <span>{$t('settings.brainSettingsPage.account.profile')}</span>
          </div>
          <ChevronRight size={16} />
        </button>

        {#if multiTenant}
          <button type="button" class={linkItemBase} onclick={onLogout} disabled={accountBusy}>
            <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
              <LogOut size={16} />
              <span>{$t('settings.brainSettingsPage.account.signOut')}</span>
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
              <span>{$t('settings.brainSettingsPage.account.deleteAllData')}</span>
            </div>
            <div class="link-status flex flex-col items-end gap-px">
              <span class="status-sub text-xs text-muted">
                {$t('settings.brainSettingsPage.account.deleteAllDataHint')}
              </span>
            </div>
            <ChevronRight size={16} />
          </button>
        {/if}
      </div>
    </section>

    <section class="settings-section flex flex-col gap-6" aria-labelledby="settings-chat-prefs-heading">
      <SettingsSectionH2 label={$t('settings.brainSettingsPage.sections.chat')} id="settings-chat-prefs-heading">
        {#snippet icon()}
          <MessageSquare size={18} aria-hidden="true" />
        {/snippet}
      </SettingsSectionH2>
      <p
        class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-[1.45] text-muted"
        id="settings-chat-tool-display-desc"
      >
        {$t('settings.brainSettingsPage.chat.description')}
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
            value="focused"
            class="mt-[0.2rem] shrink-0 accent-accent"
            checked={chatToolDisplayMode === 'focused'}
            onchange={() => onChatToolDisplayPrefChange('focused')}
          />
          <span class="settings-chat-pref-text flex flex-col gap-[0.15rem]">
            <span class="settings-chat-pref-title text-sm font-semibold leading-[1.3] text-foreground">
              {$t('settings.brainSettingsPage.chat.focused.title')}
            </span>
            <span class="settings-chat-pref-sub text-[0.8125rem] leading-[1.4] text-muted">
              {$t('settings.brainSettingsPage.chat.focused.subtitle')}
            </span>
          </span>
        </label>
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
            <span class="settings-chat-pref-title text-sm font-semibold leading-[1.3] text-foreground">
              {$t('settings.brainSettingsPage.chat.compact.title')}
            </span>
            <span class="settings-chat-pref-sub text-[0.8125rem] leading-[1.4] text-muted"
            >{$t('settings.brainSettingsPage.chat.compact.subtitle')}</span>
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
            <span class="settings-chat-pref-title text-sm font-semibold leading-[1.3] text-foreground">
              {$t('settings.brainSettingsPage.chat.detailed.title')}
            </span>
            <span class="settings-chat-pref-sub text-[0.8125rem] leading-[1.4] text-muted">
              {$t('settings.brainSettingsPage.chat.detailed.subtitle')}
            </span>
          </span>
        </label>
      </div>
    </section>
  </div>
</div>

<ConfirmDialog
  open={deleteAllConfirmOpen}
  title={$t('settings.brainSettingsPage.deleteConfirm.title')}
  titleId="settings-delete-all-title"
  confirmLabel={$t('settings.brainSettingsPage.deleteConfirm.confirmLabel')}
  cancelLabel={$t('common.actions.cancel')}
  confirmVariant="danger"
  onDismiss={() => {
    deleteAllConfirmOpen = false
  }}
  onConfirm={() => void executeDeleteAllData()}
>
  <p>
    {$t('settings.brainSettingsPage.deleteConfirm.bodyLine1')}
  </p>
  <p>
    {$t('settings.brainSettingsPage.deleteConfirm.bodyLine2')}
  </p>
</ConfirmDialog>
