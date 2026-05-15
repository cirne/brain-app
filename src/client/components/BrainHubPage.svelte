<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw, ChevronRight, BookOpen } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import { buildInitialYourWikiDocFromWikiSlice } from '@client/lib/hub/yourWikiDocFromBackground.js'
  import { HUB_BACKGROUND_STATUS_POLL_MS } from '@client/lib/hub/hubBackgroundPoll.js'
  import { fetchWikiRecentEditsList } from '@client/lib/wiki/wikiRecentEditsFetch.js'
  import { formatRelativeDate } from '@client/lib/hub/hubRipmailSource.js'
  import WikiFileName from '@components/WikiFileName.svelte'
  import { fetchVaultStatus } from '@client/lib/vaultClient.js'
  import HubSourceRowBody from '@components/HubSourceRowBody.svelte'
  import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'
  import HubSharingSection from '@components/hub/HubSharingSection.svelte'
  import { startHubEventsConnection } from '@client/lib/hubEvents/hubEventsClient.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    /** Cross-workspace brain query hub summary; true only when server enables `BRAIN_B2B_ENABLED`. */
    brainQueryEnabled?: boolean
    onHubNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    /** Opens Brain-to-brain policy UI (`/settings/brain-access`). */
    onOpenBrainAccess?: () => void
  }

  let {
    brainQueryEnabled = false,
    onHubNavigate,
    onOpenBrainAccess,
  }: Props = $props()

  let docCount = $state<number | null>(null)
  let wikiDoc = $state<BackgroundAgentDoc | null>(null)
  let wikiRecentEdits = $state<{ path: string; date: string }[]>([])
  let wikiRecentReady = $state(false)
  let hostedWorkspaceHandle = $state<string | undefined>(undefined)

  const wikiPhase = $derived(wikiDoc?.phase as YourWikiPhase | undefined)
  const wikiIsActive = $derived(
    wikiPhase === 'starting' || wikiPhase === 'enriching' || wikiPhase === 'cleaning',
  )
  const wikiIsPaused = $derived(wikiPhase === 'paused')

  const wikiPageCount = $derived(wikiDoc != null ? wikiDoc.pageCount : docCount)

  function applyBackgroundStatusPayload(bg: BackgroundStatusResponse): void {
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

  async function fetchData() {
    try {
      const [wikiRes, bgRes] = await Promise.all([
        fetch('/api/wiki', { credentials: 'include' }),
        fetch('/api/background-status', { credentials: 'include' }),
      ])

      if (wikiRes.ok) {
        docCount = parseWikiListApiBody(await wikiRes.json()).files.length
      }
      if (bgRes.ok) {
        applyBackgroundStatusPayload((await bgRes.json()) as BackgroundStatusResponse)
      }
      wikiRecentEdits = await fetchWikiRecentEditsList(5)
    } catch {
      /* ignore */
    } finally {
      wikiRecentReady = true
    }
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
    void fetchData()
    const pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void refreshBackgroundStatusPoll()
    }, HUB_BACKGROUND_STATUS_POLL_MS)
    const unsubEvents = subscribe((e) => {
      if (e.type === 'wiki:mutated' || e.type === 'sync:completed') {
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

  const sectionHeaderBase =
    'section-header flex items-center gap-3 border-b border-border pb-3 text-foreground'
  const linkItemBase =
    'link-item flex cursor-pointer items-center justify-between border-0 border-b border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-transparent py-2 text-left text-foreground transition-[padding,color] duration-150 hover:not-disabled:not-[.static]:not-[.disabled]:pl-1 hover:not-disabled:not-[.static]:not-[.disabled]:text-accent'
</script>

<div
  class="hub-page mx-auto flex w-full max-w-[900px] flex-col gap-12 px-8 py-10 text-foreground max-md:px-4 max-md:py-6"
>
  <header class="hub-header border-b border-border pb-4">
    <div class="hub-header-content">
      <h1 class="m-0 text-[2rem] font-extrabold tracking-[-0.02em]">{$t('hub.brainHubPage.title')}</h1>
      <div
        class={cn(
          'hub-header-deck mt-2',
          !!hostedWorkspaceHandle && 'hub-header-deck--hosted flex flex-col gap-[0.3rem]',
        )}
      >
        {#if hostedWorkspaceHandle}
          <p
            class="hub-handle-line m-0 font-mono text-[0.9375rem] font-medium tracking-[0.02em] text-muted"
            translate="no"
          >@{hostedWorkspaceHandle}</p>
        {/if}
      </div>
    </div>
  </header>

  <div class="hub-grid flex flex-col gap-10">
    <section
      class="hub-section your-wiki-section flex flex-col gap-5"
      aria-label={$t('hub.brainHubPage.wikiActivity.ariaLabel')}
    >
      <div class={cn(sectionHeaderBase, 'section-header-wiki')}>
        <BookOpen size={18} />
        <h2 class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">
          {$t('hub.brainHubPage.wikiActivity.heading')}
        </h2>
        <span
          class="wiki-header-metrics ml-auto flex shrink-0 items-baseline gap-2"
          aria-live="polite"
          aria-label={wikiPageCount != null
            ? $t('nav.yourWiki.pageCount', { count: wikiPageCount })
            : $t('hub.brainHubPage.wikiActivity.pageCountLoading')}
        >
          <span
            class="wiki-header-count text-[1.25rem] font-bold tracking-[-0.01em] tabular-nums text-foreground"
            aria-hidden="true"
          >{wikiPageCount ?? '—'}</span>
          <span
            class="wiki-header-count-label text-xs font-semibold uppercase tracking-[0.05em] text-muted"
            aria-hidden="true"
          >{$t('hub.brainHubPage.wikiActivity.pagesLabel')}</span>
        </span>
      </div>

      <p class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-[1.45] text-muted">
        {$t('hub.brainHubPage.wikiActivity.description')}
      </p>

      <div class="links-list flex flex-col">
        <button
          type="button"
          class={cn(linkItemBase, 'hub-source-row')}
          onclick={() => onHubNavigate({ type: 'your-wiki' })}
        >
          <div
            class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium"
          >
            <HubSourceRowBody
              title={$t('hub.brainHubPage.wikiActivity.logTitle')}
              subtitle={$t('hub.brainHubPage.wikiActivity.logSubtitle')}
            >
              {#snippet icon()}
                {#if wikiIsActive}
                  <RefreshCw size={16} class={cn('spin-icon shrink-0 text-accent')} aria-hidden="true" />
                {:else}
                  <BookOpen size={16} class="shrink-0 text-muted" aria-hidden="true" />
                {/if}
              {/snippet}
            </HubSourceRowBody>
          </div>
          {#if wikiIsPaused}
            <div class="link-status flex flex-col items-end gap-px">
              <span
                class="status-pill paused bg-[color-mix(in_srgb,var(--text-2)_22%,var(--bg-3))] px-2 py-px text-[0.625rem] font-extrabold uppercase tracking-[0.05em] text-foreground"
              >{$t('nav.yourWiki.phase.paused')}</span>
            </div>
          {/if}
          <ChevronRight size={16} aria-hidden="true" />
        </button>

        {#if wikiRecentReady && wikiRecentEdits.length > 0}
          <div
            class="wiki-recent-block mt-[0.35rem] flex flex-col border-t border-t-[color-mix(in_srgb,var(--border)_40%,transparent)] pt-3"
            aria-label={$t('hub.brainHubPage.wikiActivity.recentEditsAriaLabel')}
          >
            <p
              class="wiki-recent-label mb-[0.35rem] mt-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted"
            >{$t('hub.brainHubPage.wikiActivity.recentEditsLabel')}</p>
            {#each wikiRecentEdits as f (f.path)}
              <button
                type="button"
                class={cn(
                  linkItemBase,
                  'hub-source-row wiki-recent-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-[0.45rem]',
                )}
                onclick={() => onHubNavigate({ type: 'wiki', path: f.path })}
              >
                <div
                  class="link-info wiki-recent-row-main flex min-w-0 items-center gap-3 text-[0.9375rem] font-medium"
                >
                  <HubSourceRowBody subtitle="">
                    {#snippet titleContent()}
                      <WikiFileName path={f.path} />
                    {/snippet}
                  </HubSourceRowBody>
                </div>
                <div class="wiki-recent-row-meta inline-flex shrink-0 items-center justify-end gap-2">
                  <span
                    class="status-sub wiki-recent-time whitespace-nowrap text-xs text-muted"
                  >{formatRelativeDate(f.date, $t)}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </div>
              </button>
            {/each}
          </div>
        {:else if wikiRecentReady}
          <p
            class="empty-msg wiki-recent-empty mt-2 border-t border-t-[color-mix(in_srgb,var(--border)_40%,transparent)] px-0 pb-0 pt-[0.65rem] text-[0.8125rem] text-muted"
          >{$t('hub.brainHubPage.wikiActivity.noRecentEdits')}</p>
        {/if}
      </div>
    </section>

    {#if brainQueryEnabled}
      <HubSharingSection
        onManageBrainAccess={() => {
          onOpenBrainAccess?.()
        }}
      />
    {/if}
  </div>
</div>

<style>
  :global(.spin-icon) {
    animation: hub-spin 2s linear infinite;
  }

  @keyframes hub-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.spin-icon) {
      animation: none;
    }
  }
</style>
