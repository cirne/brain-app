<script lang="ts">
  import { RefreshCw } from 'lucide-svelte'
  import FileSourceConfigEditor from '../FileSourceConfigEditor.svelte'
  import HubConnectorCalendarSection from './HubConnectorCalendarSection.svelte'
  import HubConnectorDriveSection from './HubConnectorDriveSection.svelte'
  import {
    formatRelativeDate,
    type HubSourceDetailOk,
  } from '@client/lib/hub/hubRipmailSource.js'

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
</script>

{#if sourceDetailError}
  <section class="hub-source-status-section">
    <p class="hub-source-status-err" role="alert">{sourceDetailError}</p>
  </section>
{:else if sourceDetail}
  {#if sourceDetail.status}
    {@const st = sourceDetail.status}
    <p class="hub-source-index-line" role="status">
      {#if isGoogleCalendar}
        <span>{st.calendarEventRows.toLocaleString()} events</span>
      {:else}
        <span>{st.documentIndexRows.toLocaleString()} documents</span>
      {/if}
      <span class="hub-source-index-line-sep" aria-hidden="true">·</span>
      <span>Last synced {formatRelativeDate(st.lastSyncedAt)}</span>
    </p>
  {/if}

  {#if isGoogleCalendar}
    <HubConnectorCalendarSection
      sourceId={sourceDetail.id}
      configuredIds={sourceDetail.calendarIds}
      onSaved={onReloadDetail}
    />
  {/if}

  {#if sourceDetail.kind === 'googleDrive'}
    <HubConnectorDriveSection
      sourceId={sourceDetail.id}
      fileSource={sourceDetail.fileSource}
      includeSharedWithMe={sourceDetail.includeSharedWithMe}
      onSaved={onReloadDetail}
    />
  {:else if sourceDetail.kind === 'localDir'}
    <FileSourceConfigEditor
      sourceId={sourceDetail.id}
      sourceKind="localDir"
      fileSource={sourceDetail.fileSource}
      onSaved={onReloadDetail}
    />
  {/if}

  {#if sourceDetail.icsUrl}
    <p class="hub-ics-line">
      <span class="hub-ics-label">Feed</span>
      <span class="hub-ics-url" title={sourceDetail.icsUrl}>{sourceDetail.icsUrl}</span>
    </p>
  {/if}

  {#if sourceDetail.statusError}
    <p class="hub-source-status-err" role="alert">{sourceDetail.statusError}</p>
  {/if}

  {#if showInlineRefresh}
    <div class="hub-source-sync-buttons hub-source-sync-buttons--inline">
      <button
        type="button"
        class="hub-dialog-btn hub-dialog-btn-primary hub-source-sync-btn"
        disabled={sourceSyncAction !== null || indexRefreshPending || driveSyncBlocked}
        title={driveSyncBlocked ? 'Add at least one Drive folder in the list above before syncing' : undefined}
        onclick={onRefresh}
      >
        <RefreshCw size={16} aria-hidden="true" class={indexRefreshPending ? 'hub-refresh-working' : ''} />
        {sourceSyncAction === 'refresh'
          ? 'Starting…'
          : indexRefreshPending
            ? 'Syncing…'
            : 'Refresh index'}
      </button>
    </div>
  {/if}
{/if}
