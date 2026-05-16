<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw, ChevronRight, BookOpen } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import type { BackgroundAgentDoc, YourWikiPhase } from '@client/lib/statusBar/backgroundAgentTypes.js'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import { subscribe } from '@client/lib/app/appEvents.js'
  import WikiFileName from '@components/WikiFileName.svelte'
  import HubSourceRowBody from '@components/HubSourceRowBody.svelte'
  import SettingsSubpageHeader from '@components/settings/SettingsSubpageHeader.svelte'
  import { yourWikiDocFromEvents } from '@client/lib/hubEvents/hubEventsStores.js'
  import { startHubEventsConnection } from '@client/lib/hubEvents/hubEventsClient.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import type { BackgroundStatusResponse } from '@shared/backgroundStatus.js'
  import { HUB_BACKGROUND_STATUS_POLL_MS } from '@client/lib/hub/hubBackgroundPoll.js'
  import { buildInitialYourWikiDocFromWikiSlice } from '@client/lib/hub/yourWikiDocFromBackground.js'
  import { fetchWikiRecentEditsList } from '@client/lib/wiki/wikiRecentEditsFetch.js'
  import { formatRelativeDate } from '@client/lib/hub/hubRipmailSource.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    onNavigateToSettingsRoot: () => void
  }

  let { onSettingsNavigate, onNavigateToSettingsRoot }: Props = $props()

  let docCount = $state<number | null>(null)
  let wikiDoc = $state<BackgroundAgentDoc | null>(null)
  let wikiRecentEdits = $state<{ path: string; date: string }[]>([])
  let wikiRecentReady = $state(false)
  let backgroundStatusLoading = $state(true)

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
    backgroundStatusLoading = true
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
      backgroundStatusLoading = false
    }
  }

  onMount(() => {
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

  const linkItemBase =
    'link-item flex cursor-pointer items-center justify-between border-0 border-b border-b-[color-mix(in_srgb,var(--border)_40%,transparent)] bg-transparent py-2 text-left text-foreground transition-[padding,color] duration-150 hover:not-disabled:not-[.static]:not-[.disabled]:pl-1 hover:not-disabled:not-[.static]:not-[.disabled]:text-accent'
</script>

<div class="settings-wiki-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-foreground">
  <SettingsSubpageHeader
    pageTitle={$t('settings.settingsWikiPage.title')}
    onNavigateToSettingsRoot={onNavigateToSettingsRoot}
  />

  <div class="settings-wiki-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
    <div class="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-8 py-8 pb-10 max-md:px-4 max-md:py-6">
      <div class="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <p class="section-lead m-0 max-w-[40rem] text-[0.9375rem] leading-[1.45] text-muted">
          {$t('settings.settingsWikiPage.lead')}
        </p>
        <span
          class="wiki-header-metrics flex shrink-0 items-baseline gap-2"
          aria-live="polite"
          aria-label={wikiPageCount != null
            ? $t('settings.settingsWikiPage.pageCountAria', { count: wikiPageCount })
            : $t('settings.settingsWikiPage.pageCountLoading')}
        >
          <span
            class="wiki-header-count text-[1.25rem] font-bold tracking-[-0.01em] tabular-nums text-foreground"
            aria-hidden="true"
          >{wikiPageCount ?? '—'}</span>
          <span
            class="wiki-header-count-label text-xs font-semibold uppercase tracking-[0.05em] text-muted"
            aria-hidden="true"
          >{$t('settings.settingsWikiPage.pagesLabel')}</span>
        </span>
      </div>

      <div class="links-list flex flex-col">
        <button
          type="button"
          class={cn(linkItemBase, 'hub-source-row')}
          onclick={() => onSettingsNavigate({ type: 'your-wiki' })}
        >
          <div class="link-info flex min-w-0 flex-1 items-center gap-3 text-[0.9375rem] font-medium">
            <HubSourceRowBody
              title={$t('settings.settingsWikiPage.openLogTitle')}
              subtitle={$t('settings.settingsWikiPage.openLogSubtitle')}
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
              >{$t('settings.settingsWikiPage.paused')}</span>
            </div>
          {/if}
          <ChevronRight size={16} aria-hidden="true" />
        </button>

        {#if wikiRecentReady && wikiRecentEdits.length > 0}
          <div
            class="wiki-recent-block mt-[0.35rem] flex flex-col border-t border-t-[color-mix(in_srgb,var(--border)_40%,transparent)] pt-3"
            aria-label={$t('settings.settingsWikiPage.recentEditsAriaLabel')}
          >
            <p
              class="wiki-recent-label mb-[0.35rem] mt-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted"
            >{$t('settings.settingsWikiPage.recentEditsLabel')}</p>
            {#each wikiRecentEdits as f (f.path)}
              <button
                type="button"
                class={cn(
                  linkItemBase,
                  'hub-source-row wiki-recent-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-[0.45rem]',
                )}
                onclick={() => onSettingsNavigate({ type: 'wiki', path: f.path })}
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
                  <span class="status-sub wiki-recent-time whitespace-nowrap text-xs text-muted"
                  >{formatRelativeDate(f.date, $t)}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </div>
              </button>
            {/each}
          </div>
        {:else if wikiRecentReady}
          <p
            class="empty-msg wiki-recent-empty mt-2 border-t border-t-[color-mix(in_srgb,var(--border)_40%,transparent)] px-0 pb-0 pt-[0.65rem] text-[0.8125rem] text-muted"
          >{$t('settings.settingsWikiPage.noRecentEdits')}</p>
        {/if}
      </div>

      {#if backgroundStatusLoading && !wikiDoc}
        <p class="m-0 text-[0.8125rem] text-muted">{$t('settings.settingsWikiPage.loadingStatus')}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  :global(.settings-wiki-shell .spin-icon) {
    animation: settings-wiki-spin 2s linear infinite;
  }

  @keyframes settings-wiki-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.settings-wiki-shell .spin-icon) {
      animation: none;
    }
  }
</style>
