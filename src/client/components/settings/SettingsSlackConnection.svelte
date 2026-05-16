<script lang="ts">
  import { onMount } from 'svelte'
  import { MessageSquare, ChevronRight } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import HubSourceRowBody from '@components/HubSourceRowBody.svelte'
  import { t } from '@client/lib/i18n/index.js'

  type SlackWorkspaceStatus = {
    slackTeamId: string
    teamName: string
    workspaceConnected: boolean
    userLinked: boolean
    slackUserId: string | null
  }

  type SlackConnectionResponse = {
    ok?: boolean
    oauthConfigured?: boolean
    workspaces?: SlackWorkspaceStatus[]
  }

  let loading = $state(true)
  let oauthConfigured = $state(false)
  let workspaces = $state<SlackWorkspaceStatus[]>([])

  let linkConfirmPending = $state(false)
  let confirmEmail = $state('')
  let confirmState = $state('')
  let confirmTeamId = $state('')
  let confirmSlackUserId = $state('')
  let confirmError = $state('')
  let confirmLoading = $state(false)

  const linkItemBase =
    'link-item flex cursor-pointer items-center justify-between border border-transparent border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-transparent p-2 text-left text-foreground transition-[padding,color,background,border-color] duration-150 focus-visible:!border-accent focus-visible:bg-accent-dim focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55'

  async function fetchSlackStatus() {
    loading = true
    try {
      const res = await fetch('/api/slack/connection')
      if (!res.ok) {
        workspaces = []
        oauthConfigured = false
        return
      }
      const j = (await res.json()) as SlackConnectionResponse
      oauthConfigured = j.oauthConfigured === true
      workspaces = Array.isArray(j.workspaces) ? j.workspaces : []
    } catch {
      workspaces = []
    } finally {
      loading = false
    }
  }

  function checkLinkConfirmParams() {
    const params = new URLSearchParams(window.location.search)
    if (params.get('slackLinkConfirm') === '1') {
      confirmEmail = params.get('slackEmail') ?? ''
      confirmTeamId = params.get('slackTeamId') ?? ''
      confirmSlackUserId = params.get('slackUserId') ?? ''
      confirmState = params.get('confirmState') ?? ''
      linkConfirmPending = true
    }
  }

  async function submitLinkConfirm() {
    confirmLoading = true
    confirmError = ''
    try {
      const res = await fetch('/api/slack/oauth/link-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmState,
          slackTeamId: confirmTeamId,
          slackUserId: confirmSlackUserId,
        }),
      })
      if (!res.ok) {
        confirmError = 'Link failed. Please try again.'
        return
      }
      linkConfirmPending = false
      window.history.replaceState({}, '', '/settings')
      await fetchSlackStatus()
    } catch {
      confirmError = 'Link failed. Please try again.'
    } finally {
      confirmLoading = false
    }
  }

  function cancelLinkConfirm() {
    linkConfirmPending = false
    confirmEmail = ''
    confirmState = ''
    confirmTeamId = ''
    confirmSlackUserId = ''
    confirmError = ''
    window.history.replaceState({}, '', '/settings')
  }

  async function disconnectSlack() {
    if (!primaryWorkspace) return
    try {
      await fetch('/api/slack/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slackTeamId: primaryWorkspace.slackTeamId }),
      })
    } finally {
      await fetchSlackStatus()
    }
  }

  function startInstall() {
    window.location.assign('/api/slack/oauth/start?mode=install')
  }

  function startLink() {
    window.location.assign('/api/slack/oauth/start?mode=link')
  }

  const primaryWorkspace = $derived(workspaces[0] ?? null)
  const subtitle = $derived.by(() => {
    if (loading) return $t('settings.settingsConnectionsPage.slack.statusLoading')
    if (!oauthConfigured) return $t('settings.settingsConnectionsPage.slack.notConfigured')
    if (!primaryWorkspace?.workspaceConnected) {
      return $t('settings.settingsConnectionsPage.slack.workspaceNotConnected')
    }
    if (primaryWorkspace.userLinked) {
      return $t('settings.settingsConnectionsPage.slack.userLinked', {
        team: primaryWorkspace.teamName,
      })
    }
    return $t('settings.settingsConnectionsPage.slack.workspaceConnectedLinkYou', {
      team: primaryWorkspace.teamName,
    })
  })

  function onRowClick() {
    if (!primaryWorkspace?.workspaceConnected) startInstall()
    else startLink()
  }

  onMount(() => {
    checkLinkConfirmParams()
    void fetchSlackStatus()
  })
</script>

<div class="settings-slack-block flex flex-col gap-2">
  <h3 class="m-0 text-[0.8125rem] font-semibold uppercase tracking-[0.06em] text-muted">
    {$t('settings.settingsConnectionsPage.slack.sectionTitle')}
  </h3>
  {#if oauthConfigured}
    <button
      type="button"
      class={cn(linkItemBase, 'hub-source-row')}
      disabled={loading}
      onclick={onRowClick}
    >
      <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
        <HubSourceRowBody
          title={$t('settings.settingsConnectionsPage.slack.rowTitle')}
          {subtitle}
        >
          {#snippet icon()}
            <MessageSquare size={16} />
          {/snippet}
        </HubSourceRowBody>
      </div>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
    {#if linkConfirmPending}
      <div class="flex flex-col gap-2 rounded border border-[color-mix(in_srgb,var(--border)_60%,transparent)] p-3 text-[0.9375rem]">
        <p class="m-0">
          {$t('settings.settingsConnectionsPage.slack.linkConfirmBody', { slackEmail: confirmEmail })}
        </p>
        {#if confirmError}
          <p class="m-0 text-sm text-destructive">{confirmError}</p>
        {/if}
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-primary text-sm"
            disabled={confirmLoading}
            onclick={submitLinkConfirm}
          >
            {$t('settings.settingsConnectionsPage.slack.linkAnyway')}
          </button>
          <button
            type="button"
            class="btn btn-secondary text-sm"
            disabled={confirmLoading}
            onclick={cancelLinkConfirm}
          >
            {$t('settings.settingsConnectionsPage.slack.cancel')}
          </button>
        </div>
      </div>
    {/if}
    {#if !loading && !primaryWorkspace?.workspaceConnected}
      <button type="button" class="btn btn-secondary w-fit text-sm" onclick={startInstall}>
        {$t('settings.settingsConnectionsPage.slack.connectWorkspace')}
      </button>
    {:else if !loading && primaryWorkspace?.workspaceConnected && !primaryWorkspace.userLinked}
      <button type="button" class="btn btn-secondary w-fit text-sm" onclick={startLink}>
        {$t('settings.settingsConnectionsPage.slack.linkAccount')}
      </button>
    {:else if !loading && primaryWorkspace?.userLinked}
      <button
        type="button"
        class="w-fit bg-transparent p-0 text-sm text-muted underline-offset-2 hover:underline"
        onclick={disconnectSlack}
      >
        {$t('settings.settingsConnectionsPage.slack.disconnect')}
      </button>
    {/if}
  {:else}
    <p class="m-0 text-[0.9375rem] text-muted">
      {$t('settings.settingsConnectionsPage.slack.notConfigured')}
    </p>
  {/if}
</div>
