<script lang="ts">
  import { History, RefreshCw } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
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

  /** Shared dialog button look — inlined so tw-components don't depend on legacy `:global()` rules. */
  const hubDialogBtnBase =
    'hub-dialog-btn cursor-pointer rounded-lg border border-transparent px-[0.9rem] py-[0.45rem] text-sm font-semibold transition-[background-color,color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-60'
  const hubDialogBtnPrimary =
    'hub-dialog-btn-primary bg-accent text-white border-[color-mix(in_srgb,var(--accent)_80%,black)] hover:not-disabled:brightness-[1.06]'
  const hubDialogBtnSecondary =
    'hub-dialog-btn-secondary bg-transparent text-foreground border-[color-mix(in_srgb,var(--border)_80%,transparent)] hover:not-disabled:bg-surface-2'
  const hubSourceSyncBtn = 'hub-source-sync-btn inline-flex items-center gap-[0.4rem]'

  const sectionDivider =
    'border-t border-[color-mix(in_srgb,var(--border)_50%,transparent)] pt-[0.85rem]'
  const headingClass =
    'hub-source-status-heading m-0 text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-muted'
  const noteClass = 'hub-source-status-note m-0 text-[0.8125rem] leading-[1.45] text-muted'
  const noteActive = 'hub-source-status-note--active text-accent font-semibold'
  const errClass = 'hub-source-status-err m-0 text-[0.8125rem] leading-[1.45] text-danger'
  const warnClass =
    'hub-source-status-warn m-0 text-[0.8125rem] leading-[1.45] text-foreground bg-surface-2 border border-[color-mix(in_srgb,var(--border)_75%,transparent)] rounded-lg px-[0.65rem] py-2'
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
  <h2 id="hub-mail-status-heading" class={headingClass}>Mailbox</h2>
  {#if mailStatusLoading && !mailStatus}
    <p class={noteClass} role="status">Loading status…</p>
  {:else if mailStatusError}
    <p class={errClass} role="alert">{mailStatusError}</p>
  {:else if mailStatus}
    {#if mailStatus.index.staleLockInDb}
      <p class={warnClass} role="alert">
        A previous sync stopped unexpectedly. Quit Braintunnel completely and reopen to clear the stale lock.
      </p>
    {/if}
    {#if mailStatus.index.refreshRunning || mailStatus.index.backfillRunning}
      <p class={cn(noteClass, noteActive)} role="status">
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
      <p class={warnClass}>
        This account is configured but has no indexed mail yet. Run backfill (or refresh) to pull history.
      </p>
    {/if}
    {#if mailStatus.mailbox}
      {@const mb = mailStatus.mailbox}
      {@const idx = mailStatus.index}
      <p class={indexLineClass} role="status">
        <span>{mb.messageCount.toLocaleString()} messages</span>
        <span class={indexLineSep} aria-hidden="true">·</span>
        <span>{formatDay(mb.earliestDate)} — {formatDay(mb.latestDate)}</span>
        <span class={indexLineSep} aria-hidden="true">·</span>
        <span>Last sync {formatLastSync(idx)}</span>
      </p>
    {:else}
      <p class={noteClass}>
        No mailbox row in <code class={codeClass}>ripmail status</code> for this source id yet. After the first
        successful sync, counts and dates will appear here.
      </p>
    {/if}
  {/if}
</section>

{#if mailKind === 'imap'}
  <section
    class={cn('hub-source-prefs-section flex flex-col gap-[0.6rem]', sectionDivider)}
    aria-labelledby="hub-mail-prefs-heading"
  >
    <h2 id="hub-mail-prefs-heading" class={headingClass}>This mailbox</h2>
    <p class={noteClass}>
      Settings for this mailbox only — other accounts in your workspace are unaffected.
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
          Search this mailbox by default
        </span>
        <span class="hub-source-pref-sub text-[0.8125rem] leading-[1.4] text-muted">
          When off, Braintunnel only searches this mailbox if you ask it to. It still gets indexed in the background.
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
          Send from this mailbox by default
        </span>
        <span class="hub-source-pref-sub text-[0.8125rem] leading-[1.4] text-muted">
          When you ask Braintunnel to send a message and don't name an account, it uses this one.
        </span>
      </span>
    </label>
  </section>
{/if}

<div class={cn('hub-source-mail-sync flex flex-col gap-3', sectionDivider)}>
  <p class="hub-source-sync-lead m-0 text-[0.8125rem] leading-[1.45] text-muted">
    Refresh pulls new mail for this account. Backfill re-downloads history for the window below (long-running).
  </p>
  <div
    class="hub-source-sync-controls flex flex-wrap items-center gap-x-4 gap-y-2"
  >
    <label
      class="hub-backfill-label text-[0.8125rem] font-semibold text-muted"
      for="hub-panel-backfill-since"
    >
      Backfill window
    </label>
    <select
      id="hub-panel-backfill-since"
      class="hub-backfill-select min-w-36 cursor-pointer rounded-lg border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface px-[0.6rem] py-[0.35rem] text-sm text-foreground"
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
        class={cn(hubDialogBtnBase, hubDialogBtnPrimary, hubSourceSyncBtn)}
        disabled={sourceSyncAction !== null}
        onclick={onRefresh}
      >
        <RefreshCw size={16} aria-hidden="true" />
        {sourceSyncAction === 'refresh' ? 'Starting…' : 'Refresh'}
      </button>
    {/if}
    <button
      type="button"
      class={cn(hubDialogBtnBase, hubDialogBtnSecondary, hubSourceSyncBtn)}
      disabled={sourceSyncAction !== null}
      onclick={onBackfill}
    >
      <History size={16} aria-hidden="true" />
      {sourceSyncAction === 'backfill' ? 'Starting…' : 'Retry sync (backfill)'}
    </button>
  </div>
</div>
