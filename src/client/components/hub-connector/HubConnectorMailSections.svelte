<script lang="ts">
  import { History, RefreshCw } from 'lucide-svelte'
  import {
    formatDay,
    formatLastSync,
    HUB_MAIL_BACKFILL_WINDOW_OPTIONS,
    type HubMailStatusOk,
  } from '@client/lib/hub/hubRipmailSource.js'

  type Props = {
    mailKind: string
    mailStatus: HubMailStatusOk | null
    mailStatusLoading: boolean
    mailStatusError: string | null
    includedInDefault: boolean | null
    isDefaultSend: boolean | null
    prefsBusy: 'visibility' | 'default-send' | null
    prefsError: string | null
    backfillWindow: string
    sourceSyncAction: 'refresh' | 'backfill' | null
    /** When false, mailbox refresh is only in SlideOver header. */
    showInlineRefresh: boolean
    onToggleIncludedInDefault: () => void
    onSetDefaultSend: (_checked: boolean) => void
    onRefresh: () => void
    onBackfill: () => void
  }

  let {
    mailKind,
    mailStatus,
    mailStatusLoading,
    mailStatusError,
    includedInDefault,
    isDefaultSend,
    prefsBusy,
    prefsError,
    backfillWindow = $bindable(),
    sourceSyncAction,
    showInlineRefresh,
    onToggleIncludedInDefault,
    onSetDefaultSend,
    onRefresh,
    onBackfill,
  }: Props = $props()
</script>

<section class="hub-source-status-section" aria-labelledby="hub-mail-status-heading">
  <h2 id="hub-mail-status-heading" class="hub-source-status-heading">Mailbox</h2>
  {#if mailStatusLoading && !mailStatus}
    <p class="hub-source-status-note" role="status">Loading status…</p>
  {:else if mailStatusError}
    <p class="hub-source-status-err" role="alert">{mailStatusError}</p>
  {:else if mailStatus}
    {#if mailStatus.index.staleLockInDb}
      <p class="hub-source-status-warn" role="alert">
        A previous sync stopped unexpectedly. Quit Braintunnel completely and reopen to clear the stale lock.
      </p>
    {/if}
    {#if mailStatus.index.refreshRunning || mailStatus.index.backfillRunning}
      <p class="hub-source-status-note hub-source-status-note--active" role="status">
        {#if mailStatus.index.refreshRunning && mailStatus.index.backfillRunning}
          Refresh and backfill are running…
        {:else if mailStatus.index.backfillRunning}
          Backfill is running…
        {:else}
          Refresh is running…
        {/if}
      </p>
    {/if}
    {#if mailStatus.mailbox?.needsBackfill}
      <p class="hub-source-status-warn">
        This account is configured but has no indexed mail yet. Run backfill (or refresh) to pull history.
      </p>
    {/if}
    {#if mailStatus.mailbox}
      {@const mb = mailStatus.mailbox}
      {@const idx = mailStatus.index}
      <p class="hub-source-index-line" role="status">
        <span>{mb.messageCount.toLocaleString()} messages</span>
        <span class="hub-source-index-line-sep" aria-hidden="true">·</span>
        <span>{formatDay(mb.earliestDate)} — {formatDay(mb.latestDate)}</span>
        <span class="hub-source-index-line-sep" aria-hidden="true">·</span>
        <span>Last sync {formatLastSync(idx)}</span>
      </p>
    {:else}
      <p class="hub-source-status-note">
        No mailbox row in <code class="hub-source-code">ripmail status</code> for this source id yet. After the first
        successful sync, counts and dates will appear here.
      </p>
    {/if}
  {/if}
</section>

{#if mailKind === 'imap'}
  <section class="hub-source-prefs-section" aria-labelledby="hub-mail-prefs-heading">
    <h2 id="hub-mail-prefs-heading" class="hub-source-status-heading">This mailbox</h2>
    <p class="hub-source-status-note">
      Settings for this mailbox only — other accounts in your workspace are unaffected.
    </p>
    {#if prefsError}
      <p class="hub-source-status-err" role="alert">{prefsError}</p>
    {/if}
    <label class="hub-source-pref-row">
      <input
        type="checkbox"
        checked={includedInDefault ?? true}
        disabled={prefsBusy !== null || includedInDefault == null}
        onchange={() => onToggleIncludedInDefault()}
      />
      <span class="hub-source-pref-text">
        <span class="hub-source-pref-title">Search this mailbox by default</span>
        <span class="hub-source-pref-sub">
          When off, Braintunnel only searches this mailbox if you ask it to. It still gets indexed in the background.
        </span>
      </span>
    </label>
    <label class="hub-source-pref-row">
      <input
        type="checkbox"
        checked={isDefaultSend === true}
        disabled={prefsBusy !== null || isDefaultSend == null}
        onchange={(e) => onSetDefaultSend((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="hub-source-pref-text">
        <span class="hub-source-pref-title">Send from this mailbox by default</span>
        <span class="hub-source-pref-sub">
          When you ask Braintunnel to send a message and don't name an account, it uses this one.
        </span>
      </span>
    </label>
  </section>
{/if}

<div class="hub-source-mail-sync">
  <p class="hub-source-sync-lead">
    Refresh pulls new mail for this account. Backfill re-downloads history for the window below (long-running).
  </p>
  <div class="hub-source-sync-controls">
    <label class="hub-backfill-label" for="hub-panel-backfill-since">Backfill window</label>
    <select id="hub-panel-backfill-since" class="hub-backfill-select" bind:value={backfillWindow}>
      {#each HUB_MAIL_BACKFILL_WINDOW_OPTIONS as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>
  <div class="hub-source-sync-buttons">
    {#if showInlineRefresh}
      <button
        type="button"
        class="hub-dialog-btn hub-dialog-btn-primary hub-source-sync-btn"
        disabled={sourceSyncAction !== null}
        onclick={onRefresh}
      >
        <RefreshCw size={16} aria-hidden="true" />
        {sourceSyncAction === 'refresh' ? 'Starting…' : 'Refresh'}
      </button>
    {/if}
    <button
      type="button"
      class="hub-dialog-btn hub-dialog-btn-secondary hub-source-sync-btn"
      disabled={sourceSyncAction !== null}
      onclick={onBackfill}
    >
      <History size={16} aria-hidden="true" />
      {sourceSyncAction === 'backfill' ? 'Starting…' : 'Retry sync (backfill)'}
    </button>
  </div>
</div>
