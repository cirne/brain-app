<script lang="ts">
  import { RefreshCw } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import FileSourceConfigEditor from '@components/FileSourceConfigEditor.svelte'
  import HubConnectorCalendarSection from '@components/hub-connector/HubConnectorCalendarSection.svelte'
  import {
    formatRelativeDate,
    type HubSourceDetailOk,
  } from '@client/lib/hub/hubRipmailSource.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    sourceDetailError: string | null
    sourceDetail: HubSourceDetailOk | null
    driveSyncBlocked: boolean
    sourceSyncAction: 'refresh' | 'backfill' | null
    indexRefreshPending: boolean
    /** When false, primary refresh lives in SlideOver header (production). */
    showInlineRefresh: boolean
    onRefresh: () => void
    onReloadDetail: () => void
  }

  let {
    sourceDetailError,
    sourceDetail,
    driveSyncBlocked,
    sourceSyncAction,
    indexRefreshPending,
    showInlineRefresh,
    onRefresh,
    onReloadDetail,
  }: Props = $props()

  const isGoogleCalendar = $derived(sourceDetail?.kind === 'googleCalendar')

  const hubSourceSyncBtn = 'bt-btn bt-btn-primary hub-source-sync-btn gap-[0.4rem]'

  const sectionDivider =
    'border-t border-[color-mix(in_srgb,var(--border)_50%,transparent)] pt-[0.85rem]'
  const errClass = 'hub-source-status-err m-0 text-[0.8125rem] leading-[1.45] text-danger'
  const indexLineClass =
    'hub-source-index-line m-0 mb-1 flex flex-wrap items-center gap-x-[0.45rem] gap-y-[0.35rem] text-[0.8125rem] leading-[1.5] text-muted'
  const indexLineSep = 'hub-source-index-line-sep opacity-45 select-none font-normal'
</script>

{#if sourceDetailError}
  <section class={cn('hub-source-status-section flex flex-col gap-[0.65rem]', sectionDivider)}>
    <p class={errClass} role="alert">{sourceDetailError}</p>
  </section>
{:else if sourceDetail}
  {#if sourceDetail.status}
    {@const st = sourceDetail.status}
    <p class={indexLineClass} role="status">
      {#if isGoogleCalendar}
        <span>{$t('inbox.hubConnectorIndexSections.summary.events', { count: st.calendarEventRows.toLocaleString() })}</span>
      {:else}
        <span>{$t('inbox.hubConnectorIndexSections.summary.documents', { count: st.documentIndexRows.toLocaleString() })}</span>
      {/if}
      <span class={indexLineSep} aria-hidden="true">·</span>
      <span>{$t('inbox.hubConnectorIndexSections.summary.lastSynced', { value: formatRelativeDate(st.lastSyncedAt) })}</span>
    </p>
  {/if}

  {#if isGoogleCalendar}
    <HubConnectorCalendarSection
      sourceId={sourceDetail.id}
      configuredIds={sourceDetail.calendarIds}
      onSaved={onReloadDetail}
    />
  {/if}

  {#if sourceDetail.kind === 'localDir'}
    <FileSourceConfigEditor
      sourceId={sourceDetail.id}
      sourceKind="localDir"
      fileSource={sourceDetail.fileSource}
      onSaved={onReloadDetail}
    />
  {/if}

  {#if sourceDetail.icsUrl}
    <p class="hub-ics-line m-0 flex flex-col gap-[0.2rem] text-[0.8125rem] leading-[1.4] text-muted">
      <span
        class="hub-ics-label text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-muted"
      >{$t('inbox.hubConnectorIndexSections.feedLabel')}</span>
      <span
        class="hub-ics-url break-all text-[0.78rem] text-foreground [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace]"
        title={sourceDetail.icsUrl}
      >{sourceDetail.icsUrl}</span>
    </p>
  {/if}

  {#if sourceDetail.statusError}
    <p class={errClass} role="alert">{sourceDetail.statusError}</p>
  {/if}

  {#if showInlineRefresh}
    <div
      class="hub-source-sync-buttons hub-source-sync-buttons--inline mt-[0.35rem] flex flex-wrap gap-2"
    >
      <button
        type="button"
        class={cn(hubSourceSyncBtn)}
        disabled={sourceSyncAction !== null || indexRefreshPending || driveSyncBlocked}
        title={driveSyncBlocked
          ? $t('inbox.hubConnectorIndexSections.refresh.driveBlockedTitle')
          : undefined}
        onclick={onRefresh}
      >
        <RefreshCw
          size={16}
          aria-hidden="true"
          class={indexRefreshPending ? 'hub-refresh-working' : ''}
        />
        {sourceSyncAction === 'refresh'
          ? $t('inbox.hubConnectorIndexSections.refresh.starting')
          : indexRefreshPending
            ? $t('inbox.hubConnectorIndexSections.refresh.syncing')
            : $t('nav.hub.refreshIndex')}
      </button>
    </div>
  {/if}
{/if}

<style>
  /* Keyframe reused by the RefreshCw icon class while a background refresh is pending. */
  :global(.hub-refresh-working) {
    animation: hub-refresh-spin 0.85s linear infinite;
  }

  @keyframes hub-refresh-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
