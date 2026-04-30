<script lang="ts">
  import { RefreshCw } from 'lucide-svelte'
  import FileSourceConfigEditor from '../FileSourceConfigEditor.svelte'
  import {
    formatDay,
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
</script>

<section class="hub-source-status-section" aria-labelledby="hub-index-detail-heading">
  <h2 id="hub-index-detail-heading" class="hub-source-status-heading">Index &amp; sync</h2>
  <p class="hub-source-status-note">
    From <code class="hub-source-code">ripmail sources status</code> and your source config.
  </p>
  {#if sourceDetailError}
    <p class="hub-source-status-err" role="alert">{sourceDetailError}</p>
  {:else if sourceDetail}
    {@const st = sourceDetail.status}
    <dl class="hub-source-meta hub-source-meta--dense">
      <div class="hub-source-meta-row">
        <dt>Documents indexed</dt>
        <dd>{st != null ? st.documentIndexRows.toLocaleString() : '—'}</dd>
      </div>
      <div class="hub-source-meta-row">
        <dt>Calendar events</dt>
        <dd>{st != null ? st.calendarEventRows.toLocaleString() : '—'}</dd>
      </div>
      <div class="hub-source-meta-row">
        <dt>Last synced</dt>
        <dd>{st != null ? formatDay(st.lastSyncedAt) : '—'}</dd>
      </div>
      <div class="hub-source-meta-row">
        <dt>Index note</dt>
        <dd>
          {#if sourceDetail.statusError}
            {sourceDetail.statusError}
          {:else}
            —
          {/if}
        </dd>
      </div>
    </dl>
    {#if sourceDetail.oauthSourceId}
      <dl class="hub-source-meta hub-source-meta--dense">
        <div class="hub-source-meta-row">
          <dt>OAuth token source</dt>
          <dd class="hub-source-id">{sourceDetail.oauthSourceId}</dd>
        </div>
      </dl>
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
      <dl class="hub-source-meta hub-source-meta--dense">
        <div class="hub-source-meta-row">
          <dt>Shared with me</dt>
          <dd>{sourceDetail.includeSharedWithMe ? 'Included' : 'Not included'}</dd>
        </div>
      </dl>
    {/if}
    {#if sourceDetail.calendarIds != null && sourceDetail.calendarIds.length > 0}
      <dl class="hub-source-meta hub-source-meta--dense">
        <div class="hub-source-meta-row">
          <dt>Calendar IDs</dt>
          <dd class="hub-source-path">{sourceDetail.calendarIds.join(', ')}</dd>
        </div>
      </dl>
    {/if}
    {#if sourceDetail.icsUrl}
      <dl class="hub-source-meta hub-source-meta--dense">
        <div class="hub-source-meta-row">
          <dt>ICS URL</dt>
          <dd class="hub-source-path">{sourceDetail.icsUrl}</dd>
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
  {/if}
</section>
