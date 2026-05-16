<script lang="ts">
  import { onMount } from 'svelte'
  import { Mail, ChevronRight, Folder, Calendar, HardDrive, Plus } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { fetchVaultStatus } from '@client/lib/vaultClient.js'
  import HubSourceRowBody from '@components/HubSourceRowBody.svelte'
  import {
    sourceKindLabel,
    type HubRipmailSourceRow,
  } from '@client/lib/hub/hubRipmailSource.js'
  import { sortHubRipmailSources } from '@client/lib/hub/hubSourceOrdering.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    selectedHubSourceId?: string
  }

  let { onSettingsNavigate, selectedHubSourceId }: Props = $props()

  let hubSources = $state<HubRipmailSourceRow[]>([])
  let hubSourcesError = $state<string | null>(null)
  let mailHiddenFromDefault = $state<Set<string>>(new Set())
  let defaultSendSourceId = $state<string | null>(null)
  let multiTenant = $state(false)

  function sourceRowSecondary(s: HubRipmailSourceRow): string {
    const k = sourceKindLabel(s.kind, $t)
    if (s.path) return `${k} · ${s.path}`
    return k
  }

  const orderedHubSources = $derived(sortHubRipmailSources(hubSources))

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

  function startAddAnotherGmail() {
    window.location.assign('/api/oauth/google/link/start')
  }

  onMount(() => {
    void fetchVaultStatus()
      .then((v) => {
        multiTenant = v.multiTenant === true
      })
      .catch(() => {
        multiTenant = false
      })
    void fetchData()
    const unsub = subscribe((e) => {
      if (e.type === 'hub:sources-changed' || e.type === 'sync:completed') void fetchData()
    })
    return () => {
      unsub()
    }
  })

  const linkItemBase =
    'link-item flex cursor-pointer items-center justify-between border border-transparent border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-transparent p-2 text-left text-foreground transition-[padding,color,background,border-color] duration-150 focus-visible:!border-accent focus-visible:bg-accent-dim focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55'
  const linkItemSelected =
    'link-item--selected !border-[color-mix(in_srgb,var(--accent)_45%,transparent)] !bg-accent-dim focus-visible:!border-accent'
</script>

<div class="settings-connections-list flex flex-col gap-6">
  <p class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-[1.45] text-muted">
    {$t('settings.settingsConnectionsPage.lead')}
  </p>
  <div class="links-list flex flex-col">
    {#if hubSourcesError}
      <p
        class="empty-msg settings-sources-err m-0 cursor-help py-4 text-[0.9375rem] text-muted"
        title={hubSourcesError}
      >
        {$t('settings.settingsConnectionsPage.errors.loadSources')}
      </p>
    {:else if orderedHubSources.length === 0}
      <p class="empty-msg m-0 py-4 text-[0.9375rem] text-muted">
        {#if multiTenant}
          {$t('settings.settingsConnectionsPage.empty.multiTenant')}
        {:else}
          {$t('settings.settingsConnectionsPage.empty.singleTenant')}
        {/if}
      </p>
    {:else}
      {#each orderedHubSources as s (s.id)}
        {@const isMail = s.kind === 'imap' || s.kind === 'applemail'}
        {@const isDefaultSend = isMail && defaultSendSourceId === s.id}
        {@const isHidden = isMail && mailHiddenFromDefault.has(s.id)}
        <button
          type="button"
          class={cn(linkItemBase, 'hub-source-row', selectedHubSourceId === s.id && linkItemSelected)}
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
                title={$t('settings.settingsConnectionsPage.badges.defaultSendTitle')}
              >
                {$t('settings.settingsConnectionsPage.badges.defaultSendLabel')}
              </span>
            {/if}
            {#if isHidden}
              <span
                class="hub-source-pill hub-source-pill--hidden whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-2 py-px text-[0.625rem] font-bold uppercase tracking-[0.04em] text-muted"
                title={$t('settings.settingsConnectionsPage.badges.hiddenFromSearchTitle')}
              >
                {$t('settings.settingsConnectionsPage.badges.hiddenFromSearchLabel')}
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
          title={$t('settings.settingsConnectionsPage.addAnotherGmail.title')}
          subtitle={$t('settings.settingsConnectionsPage.addAnotherGmail.subtitle')}
        >
          {#snippet icon()}
            <Plus size={16} />
          {/snippet}
        </HubSourceRowBody>
      </div>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  </div>
</div>
