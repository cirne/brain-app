<script lang="ts">
  import { RefreshCw } from 'lucide-svelte'
  import FileSourceConfigEditor from '../FileSourceConfigEditor.svelte'
  import HubConnectorCalendarSection from './HubConnectorCalendarSection.svelte'
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
    onRefresh: () => void
    onReloadDetail: () => void
  }

  let {
    sourceDetailError,
    sourceDetail,
    driveSyncBlocked,
    sourceSyncAction,
    indexRefreshPending,
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
  {#if isGoogleCalendar}
    <HubConnectorCalendarSection
      sourceId={sourceDetail.id}
      configuredIds={sourceDetail.calendarIds}
      onSaved={onReloadDetail}
    />
  {/if}

  {#if sourceDetail.kind === 'localDir' || sourceDetail.kind === 'googleDrive'}
    <FileSourceConfigEditor
      sourceId={sourceDetail.id}
      sourceKind={sourceDetail.kind === 'googleDrive' ? 'googleDrive' : 'localDir'}
      fileSource={sourceDetail.fileSource}
      onSaved={onReloadDetail}
    />
  {/if}

  {#if sourceDetail.kind === 'googleDrive'}
    <section class="hub-source-status-section" aria-labelledby="hub-drive-prefs-heading">
      <h2 id="hub-drive-prefs-heading" class="hub-source-status-heading">Preferences</h2>
      <dl class="hub-source-meta hub-source-meta--dense">
        <div class="hub-source-meta-row">
          <dt>Shared with me</dt>
          <dd>{sourceDetail.includeSharedWithMe ? 'Included' : 'Not included'}</dd>
        </div>
      </dl>
    </section>
  {/if}

  {#if sourceDetail.icsUrl}
    <section class="hub-source-status-section" aria-labelledby="hub-ics-heading">
      <h2 id="hub-ics-heading" class="hub-source-status-heading">Calendar feed</h2>
      <dl class="hub-source-meta hub-source-meta--dense">
        <div class="hub-source-meta-row">
          <dt>ICS URL</dt>
          <dd class="hub-source-path">{sourceDetail.icsUrl}</dd>
        </div>
      </dl>
    </section>
  {/if}

  <section class="hub-source-status-section" aria-labelledby="hub-sync-heading">
    <h2 id="hub-sync-heading" class="hub-source-status-heading">Index &amp; sync</h2>
    {#if sourceDetail.statusError}
      <p class="hub-source-status-err" role="alert">{sourceDetail.statusError}</p>
    {/if}
    {#if sourceDetail.status}
      {@const st = sourceDetail.status}
      <dl class="hub-source-meta hub-source-meta--dense">
        {#if isGoogleCalendar}
          <div class="hub-source-meta-row">
            <dt>Events indexed</dt>
            <dd>{st.calendarEventRows.toLocaleString()}</dd>
          </div>
        {:else}
          <div class="hub-source-meta-row">
            <dt>Documents indexed</dt>
            <dd>{st.documentIndexRows.toLocaleString()}</dd>
          </div>
        {/if}
        <div class="hub-source-meta-row">
          <dt>Last synced</dt>
          <dd>{formatRelativeDate(st.lastSyncedAt)}</dd>
        </div>
      </dl>
    {/if}
    <div class="hub-source-sync-buttons">
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
  </section>
{/if}
