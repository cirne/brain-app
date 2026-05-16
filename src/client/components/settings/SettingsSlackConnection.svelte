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
    {#if !loading && !primaryWorkspace?.workspaceConnected}
      <button type="button" class="btn btn-secondary w-fit text-sm" onclick={startInstall}>
        {$t('settings.settingsConnectionsPage.slack.connectWorkspace')}
      </button>
    {:else if !loading && primaryWorkspace?.workspaceConnected && !primaryWorkspace.userLinked}
      <button type="button" class="btn btn-secondary w-fit text-sm" onclick={startLink}>
        {$t('settings.settingsConnectionsPage.slack.linkAccount')}
      </button>
    {/if}
  {:else}
    <p class="m-0 text-[0.9375rem] text-muted">
      {$t('settings.settingsConnectionsPage.slack.notConfigured')}
    </p>
  {/if}
</div>
