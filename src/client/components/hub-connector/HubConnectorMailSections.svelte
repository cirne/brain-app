<script lang="ts">
  import { History, RefreshCw } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import {
    formatDay,
    formatLastSync,
    HUB_MAIL_BACKFILL_WINDOW_OPTIONS,
    type HubMailStatusOk,
  } from '@client/lib/hub/hubRipmailSource.js'
  import { t } from '@client/lib/i18n/index.js'

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

  const btnPrimary = 'bt-btn bt-btn-primary'
  const btnSecondary = 'bt-btn bt-btn-secondary'
  const hubSourceSyncBtn = 'hub-source-sync-btn gap-[0.4rem]'

  const sectionDivider =
    'border-t border-[color-mix(in_srgb,var(--border)_50%,transparent)] pt-[0.85rem]'
  const headingClass =
    'hub-source-status-heading m-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted'
  const noteClass = 'hub-source-status-note m-0 text-[0.8125rem] leading-[1.45] text-muted'
  const noteActive = 'hub-source-status-note--active text-accent font-semibold'
  const errClass = 'hub-source-status-err m-0 text-[0.8125rem] leading-[1.45] text-danger'
  const warnClass =
    'hub-source-status-warn m-0 text-[0.8125rem] leading-[1.45] text-foreground bg-surface-2 border border-[color-mix(in_srgb,var(--border)_75%,transparent)] px-[0.65rem] py-2'
  const indexLineClass =
    'hub-source-index-line m-0 mb-1 flex flex-wrap items-center gap-x-[0.45rem] gap-y-[0.35rem] text-[0.8125rem] leading-[1.5] text-muted'
  const indexLineSep = 'hub-source-index-line-sep opacity-45 select-none font-normal'
  const codeClass =
    'hub-source-code text-[0.8em] [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation_Mono","Courier_New",monospace]'
</script>

<section
  class={cn('hub-source-status-section flex flex-col gap-[0.65rem]', sectionDivider)}
  aria-labelledby="hub-mail-status-heading"
>
  <h2 id="hub-mail-status-heading" class={headingClass}>{$t('inbox.hubConnectorMailSections.mailboxHeading')}</h2>
  {#if mailStatusLoading && !mailStatus}
    <p class={noteClass} role="status">{$t('inbox.hubConnectorMailSections.loadingStatus')}</p>
  {:else if mailStatusError}
    <p class={errClass} role="alert">{mailStatusError}</p>
  {:else if mailStatus}
    {#if mailStatus.index.staleLockInDb}
      <p class={warnClass} role="alert">
        {$t('inbox.hubConnectorMailSections.warnings.staleLock')}
      </p>
    {/if}
    {#if mailStatus.index.refreshRunning || mailStatus.index.backfillRunning}
      <p class={cn(noteClass, noteActive)} role="status">
        {#if mailStatus.index.refreshRunning && mailStatus.index.backfillRunning}
          {$t('inbox.hubConnectorMailSections.status.refreshAndBackfillRunning')}
        {:else if mailStatus.index.backfillRunning}
          {$t('inbox.hubConnectorMailSections.status.backfillRunning')}
        {:else}
          {$t('inbox.hubConnectorMailSections.status.refreshRunning')}
        {/if}
      </p>
    {/if}
    {#if mailStatus.mailbox?.needsBackfill}
      <p class={warnClass}>
        {$t('inbox.hubConnectorMailSections.warnings.needsBackfill')}
      </p>
    {/if}
    {#if mailStatus.mailbox}
      {@const mb = mailStatus.mailbox}
      {@const idx = mailStatus.index}
      <p class={indexLineClass} role="status">
        <span>{$t('inbox.hubConnectorMailSections.summary.messages', { count: mb.messageCount.toLocaleString() })}</span>
        <span class={indexLineSep} aria-hidden="true">·</span>
        <span>{formatDay(mb.earliestDate)} — {formatDay(mb.latestDate)}</span>
        <span class={indexLineSep} aria-hidden="true">·</span>
        <span>{$t('inbox.hubConnectorMailSections.summary.lastSync', { value: formatLastSync(idx) })}</span>
      </p>
    {:else}
      <p class={noteClass}>
        {$t('inbox.hubConnectorMailSections.summary.noMailboxRowPrefix')}
        <code class={codeClass}>ripmail status</code>
        {$t('inbox.hubConnectorMailSections.summary.noMailboxRowSuffix')}
      </p>
    {/if}
  {/if}
</section>

{#if mailKind === 'imap'}
  <section
    class={cn('hub-source-prefs-section flex flex-col gap-[0.6rem]', sectionDivider)}
    aria-labelledby="hub-mail-prefs-heading"
  >
    <h2 id="hub-mail-prefs-heading" class={headingClass}>{$t('inbox.hubConnectorMailSections.preferences.heading')}</h2>
    <p class={noteClass}>
      {$t('inbox.hubConnectorMailSections.preferences.description')}
    </p>
    {#if prefsError}
      <p class={errClass} role="alert">{prefsError}</p>
    {/if}
    <label
      class="hub-source-pref-row flex cursor-pointer items-start gap-[0.6rem] py-[0.45rem]"
    >
      <input
        type="checkbox"
        class="mt-[0.2rem] shrink-0 [accent-color:var(--accent)]"
        checked={includedInDefault ?? true}
        disabled={prefsBusy !== null || includedInDefault == null}
        onchange={() => onToggleIncludedInDefault()}
      />
      <span class="hub-source-pref-text flex flex-col gap-[0.15rem]">
        <span class="hub-source-pref-title text-sm font-semibold leading-[1.3] text-foreground">
          {$t('inbox.hubConnectorMailSections.preferences.searchByDefaultTitle')}
        </span>
        <span class="hub-source-pref-sub text-[0.8125rem] leading-[1.4] text-muted">
          {$t('inbox.hubConnectorMailSections.preferences.searchByDefaultDescription')}
        </span>
      </span>
    </label>
    <label
      class="hub-source-pref-row flex cursor-pointer items-start gap-[0.6rem] py-[0.45rem]"
    >
      <input
        type="checkbox"
        class="mt-[0.2rem] shrink-0 [accent-color:var(--accent)]"
        checked={isDefaultSend === true}
        disabled={prefsBusy !== null || isDefaultSend == null}
        onchange={(e) => onSetDefaultSend((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="hub-source-pref-text flex flex-col gap-[0.15rem]">
        <span class="hub-source-pref-title text-sm font-semibold leading-[1.3] text-foreground">
          {$t('inbox.hubConnectorMailSections.preferences.sendByDefaultTitle')}
        </span>
        <span class="hub-source-pref-sub text-[0.8125rem] leading-[1.4] text-muted">
          {$t('inbox.hubConnectorMailSections.preferences.sendByDefaultDescription')}
        </span>
      </span>
    </label>
  </section>
{/if}

<div class={cn('hub-source-mail-sync flex flex-col gap-3', sectionDivider)}>
  <p class="hub-source-sync-lead m-0 text-[0.8125rem] leading-[1.45] text-muted">
    {$t('inbox.hubConnectorMailSections.sync.description')}
  </p>
  <div
    class="hub-source-sync-controls flex flex-wrap items-center gap-x-4 gap-y-2"
  >
    <label
      class="hub-backfill-label text-[0.8125rem] font-semibold text-muted"
      for="hub-panel-backfill-since"
    >
      {$t('inbox.hubConnectorMailSections.sync.backfillWindow')}
    </label>
    <select
      id="hub-panel-backfill-since"
      class="hub-backfill-select min-w-36 cursor-pointer border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface px-[0.6rem] py-[0.35rem] text-sm text-foreground"
      bind:value={backfillWindow}
    >
      {#each HUB_MAIL_BACKFILL_WINDOW_OPTIONS as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  </div>
  <div class="hub-source-sync-buttons flex flex-wrap gap-2">
    {#if showInlineRefresh}
      <button
        type="button"
        class={cn(btnPrimary, hubSourceSyncBtn)}
        disabled={sourceSyncAction !== null}
        onclick={onRefresh}
      >
        <RefreshCw size={16} aria-hidden="true" />
        {sourceSyncAction === 'refresh'
          ? $t('inbox.hubConnectorMailSections.sync.starting')
          : $t('common.actions.refresh')}
      </button>
    {/if}
    <button
      type="button"
      class={cn(btnSecondary, hubSourceSyncBtn)}
      disabled={sourceSyncAction !== null}
      onclick={onBackfill}
    >
      <History size={16} aria-hidden="true" />
      {sourceSyncAction === 'backfill'
        ? $t('inbox.hubConnectorMailSections.sync.starting')
        : $t('inbox.hubConnectorMailSections.sync.retryBackfill')}
    </button>
  </div>
</div>
