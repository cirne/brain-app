<script lang="ts">
  import { Mail, BookOpen, Cable, RefreshCw, Pause, Play, Loader2 } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import type { OnboardingMailStatus } from '@client/lib/onboarding/onboardingTypes.js'
  import { formatMailIndexCoverage } from '@client/lib/onboarding/formatMailCoverageRange.js'
  import type { YourWikiPhase } from '@shared/backgroundStatus.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    mailStatus: OnboardingMailStatus | null
    mailLoading: boolean
    wikiTitle: string
    wikiSubtitle: string
    wikiPhase: YourWikiPhase | undefined
    wikiIsActive: boolean
    wikiIsPaused: boolean
    wikiIsIdle: boolean
    /** When true, wiki row shows pause / resume / update controls. */
    showWikiControls: boolean
    onSyncNow?: () => void | Promise<void>
    onWikiUpdateNow?: () => void | Promise<void>
    onPause?: () => void | Promise<void>
    onResume?: () => void | Promise<void>
    syncBusy?: boolean
    wikiUpdateBusy?: boolean
    wikiActionBusy?: boolean
    indexFeedSummary: string
    sourcesEmpty: boolean
    sourcesError: string | null
    /** Settings navigation (SPA when callback set). */
    onOpenSettings?: () => void
  }

  let {
    mailStatus,
    mailLoading,
    wikiTitle,
    wikiSubtitle,
    wikiPhase: _wikiPhase,
    wikiIsActive,
    wikiIsPaused,
    wikiIsIdle,
    showWikiControls,
    onSyncNow,
    onWikiUpdateNow,
    onPause,
    onResume,
    syncBusy = false,
    wikiUpdateBusy = false,
    wikiActionBusy = false,
    indexFeedSummary,
    sourcesEmpty,
    sourcesError,
    onOpenSettings,
  }: Props = $props()

  /** Matches “Your wiki” row: category icon when idle, same activity spinner when background mail work is running. */
  const mailBackgroundActive = $derived(
    Boolean(
      mailStatus &&
        (mailStatus.syncRunning ||
          mailStatus.refreshRunning ||
          mailStatus.backfillRunning),
    ),
  )

  const wikiBtnBase = 'bt-btn px-[0.65rem] py-[0.3rem] text-[0.8125rem] gap-[0.3rem]'
  const wikiBtnPrimary = 'bt-btn-primary'
  const wikiBtnSecondary = 'bt-btn-secondary hover:not-disabled:bg-surface-3'
  const wikiBtnGhost =
    'border-transparent bg-transparent text-muted hover:not-disabled:bg-surface-3 hover:not-disabled:text-foreground'

  const rowIconClass = 'mt-0.5 shrink-0 text-muted'

  function formatSyncLockAge(ms: number | null): string {
    if (ms == null || ms < 60_000) return ''
    const m = Math.floor(ms / 60_000)
    if (m < 60) return ` · ${m}m`
    const h = Math.floor(m / 60)
    return ` · ${h}h`
  }

  function formatRelativeDate(iso: string): string {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffSec < 60) return $t('hub.hubActivityOverview.relativeTime.justNow')
    if (diffMin < 60) return $t('hub.hubActivityOverview.relativeTime.minutesAgo', { count: diffMin })
    if (diffHour < 24) return $t('hub.hubActivityOverview.relativeTime.hoursAgo', { count: diffHour })
    if (diffDay === 1) return $t('hub.hubActivityOverview.relativeTime.yesterday')
    if (diffDay < 7) return $t('hub.hubActivityOverview.relativeTime.daysAgo', { count: diffDay })
    return d.toLocaleDateString()
  }
</script>

<section
  class="hub-overview rounded-lg border border-border bg-[color-mix(in_srgb,var(--surface-2)_88%,transparent)] p-4 shadow-[0_1px_6px_rgba(0,0,0,0.04)]"
  aria-labelledby="hub-overview-heading"
>
  <h2
    id="hub-overview-heading"
    class="m-0 border-b border-[color-mix(in_srgb,var(--border)_45%,transparent)] pb-3 text-[0.9375rem] font-bold tracking-[0.02em] text-foreground"
  >
    {$t('hub.hubActivityOverview.heading')}
  </h2>

  <div class="mt-4 flex flex-col gap-0">
    <!-- Mail -->
    <div
      class="flex flex-col gap-2 border-b border-[color-mix(in_srgb,var(--border)_35%,transparent)] py-3 first:pt-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
    >
      <div class="flex min-w-0 flex-1 gap-3">
        {#if mailBackgroundActive}
          <RefreshCw
            size={18}
            class="spin-icon mt-0.5 shrink-0 text-accent"
            aria-hidden="true"
            title={$t('hub.hubActivityOverview.mail.updatingTitle')}
          />
        {:else}
          <Mail size={18} class={rowIconClass} aria-hidden="true" />
        {/if}
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[0.8125rem] font-semibold text-foreground">
            {$t('hub.hubActivityOverview.mail.title')}
          </p>
          {#if mailLoading && !mailStatus}
            <p class="mt-0.5 m-0 flex items-center gap-1.5 text-[0.8125rem] text-muted">
              <Loader2 size={14} class="shrink-0 animate-spin" aria-hidden="true" />
              {$t('common.status.loading')}
            </p>
          {:else if mailStatus?.statusError}
            <p class="mt-0.5 m-0 text-[0.8125rem] text-[var(--text-3)]" title={mailStatus.statusError}>
              {$t('hub.hubActivityOverview.mail.statusUnavailable')}
            </p>
          {:else if mailStatus}
            {@const mailCoverage = formatMailIndexCoverage(mailStatus.dateRange.from, mailStatus.dateRange.to, {
              present: $t('hub.hubActivityOverview.mail.coveragePresent'),
              since: (d) => $t('hub.hubActivityOverview.mail.coverageSince', { date: d }),
              range: (start, end) =>
                $t('hub.hubActivityOverview.mail.coverageRange', { start, end }),
              newestAround: (d) =>
                $t('hub.hubActivityOverview.mail.coverageNewestAround', { date: d }),
            })}
            <p class="mt-0.5 m-0 text-[0.8125rem] leading-snug text-muted">
              <span class="tabular-nums font-semibold text-foreground"
                >{mailStatus.indexedTotal != null ? mailStatus.indexedTotal.toLocaleString() : '—'}</span
              >
              {$t('hub.hubActivityOverview.mail.messagesIndexed')}
              {#if mailCoverage}
                <span class="text-foreground/90"> · {mailCoverage}</span>
              {/if}
              {#if mailStatus.syncRunning}
                <span class="font-semibold text-accent">
                  {$t('hub.hubActivityOverview.mail.syncing', {
                    lockAge: formatSyncLockAge(mailStatus.syncLockAgeMs),
                  })}</span
                >
              {:else if mailStatus.lastSyncedAt}
                <span>
                  {$t('hub.hubActivityOverview.mail.lastSynced', {
                    value: formatRelativeDate(mailStatus.lastSyncedAt),
                  })}
                </span>
              {:else if mailStatus.configured}
                <span>{$t('hub.hubActivityOverview.mail.noSyncTimeYet')}</span>
              {/if}
            </p>
            {#if mailStatus.deepHistoricalPending}
              <p class="mt-1 m-0 text-[0.75rem] leading-snug text-muted">
                {$t('hub.hubActivityOverview.mail.moreHistorySyncing')}
              </p>
            {/if}
          {:else}
            <p class="mt-0.5 m-0 text-[0.8125rem] text-muted">{$t('common.status.loading')}</p>
          {/if}
        </div>
      </div>
      {#if onSyncNow}
        <div class="flex shrink-0 justify-end sm:pt-0.5">
          <button
            type="button"
            class="{wikiBtnBase} {wikiBtnSecondary} max-sm:w-full max-sm:justify-center"
            disabled={syncBusy}
            aria-busy={syncBusy ? true : undefined}
            onclick={() => void onSyncNow()}
          >
            <RefreshCw size={14} class={cn(syncBusy && 'animate-spin')} aria-hidden="true" />
            {$t('hub.hubActivityOverview.mail.syncNow')}
          </button>
        </div>
      {/if}
    </div>

    <!-- Wiki -->
    <div
      class="flex flex-col gap-2 border-b border-[color-mix(in_srgb,var(--border)_35%,transparent)] py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
    >
      <div class="flex min-w-0 flex-1 gap-3">
        {#if wikiIsActive}
          <RefreshCw
            size={18}
            class="spin-icon mt-0.5 shrink-0 text-accent"
            aria-hidden="true"
            title={$t('hub.hubActivityOverview.wiki.updatingTitle')}
          />
        {:else}
          <BookOpen size={18} class={rowIconClass} aria-hidden="true" />
        {/if}
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[0.8125rem] font-semibold text-foreground">
            {$t('hub.hubActivityOverview.wiki.title')}
          </p>
          <p class="mt-0.5 m-0 text-[0.9375rem] font-medium leading-snug text-foreground">{wikiTitle}</p>
          <p class="mt-0.5 m-0 line-clamp-2 text-[0.8125rem] leading-snug text-muted">{wikiSubtitle}</p>
        </div>
      </div>
      {#if showWikiControls && (onPause || onResume || onWikiUpdateNow)}
        <div
          class="flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:justify-stretch [&>button]:max-sm:flex-1"
          role="group"
          aria-label={$t('hub.hubActivityOverview.wiki.controlsAriaLabel')}
        >
          {#if wikiIsActive || (wikiIsIdle && !wikiIsPaused)}
            <button
              type="button"
              class="{wikiBtnBase} {wikiBtnSecondary}"
              disabled={wikiActionBusy}
              onclick={() => void onPause?.()}
              title={$t('hub.hubActivityOverview.wiki.pauseTitle')}
            >
              <Pause size={14} aria-hidden="true" />
              {$t('common.actions.pause')}
            </button>
          {:else if wikiIsPaused || _wikiPhase === 'error'}
            <button
              type="button"
              class="{wikiBtnBase} {wikiBtnPrimary}"
              disabled={wikiActionBusy}
              onclick={() => void onResume?.()}
              title={$t('hub.hubActivityOverview.wiki.resumeTitle')}
            >
              <Play size={14} aria-hidden="true" />
              {$t('common.actions.resume')}
            </button>
          {/if}
          {#if wikiIsIdle && !wikiIsPaused && onWikiUpdateNow}
            <button
              type="button"
              class="{wikiBtnBase} {wikiBtnGhost}"
              disabled={wikiActionBusy || wikiUpdateBusy}
              onclick={() => void onWikiUpdateNow()}
              title={$t('hub.hubActivityOverview.wiki.updateNowTitle')}
            >
              <RefreshCw size={14} class={cn(wikiUpdateBusy && 'animate-spin')} aria-hidden="true" />
              {$t('hub.hubActivityOverview.wiki.updateNow')}
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Sources -->
    <div class="flex flex-col gap-1 py-3 pt-4">
      <div class="flex min-w-0 flex-1 gap-3">
        <Cable size={18} class={rowIconClass} aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[0.8125rem] font-semibold text-foreground">
            {$t('hub.hubActivityOverview.sources.title')}
          </p>
          {#if sourcesError}
            <p class="mt-0.5 m-0 cursor-help text-[0.8125rem] text-[var(--text-3)]" title={sourcesError}>
              {$t('hub.hubActivityOverview.sources.couldNotLoadSummary')}
            </p>
          {:else if sourcesEmpty}
            <p class="mt-0.5 m-0 text-[0.8125rem] text-muted">
              {$t('hub.hubActivityOverview.sources.noneYet')}
            </p>
          {:else}
            <p class="mt-0.5 m-0 text-[0.8125rem] leading-snug text-muted">{indexFeedSummary}</p>
          {/if}
          {#if onOpenSettings}
            <button
              type="button"
              class="hub-overview-settings mt-2 inline-flex cursor-pointer border-0 bg-transparent p-0 text-[0.8125rem] font-semibold text-accent underline decoration-[color-mix(in_srgb,var(--accent)_45%,transparent)] underline-offset-[0.12em] hover:decoration-[var(--accent)]"
              onclick={() => onOpenSettings()}
            >
              {$t('hub.hubActivityOverview.sources.manageInSettings')}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  :global(.hub-overview .spin-icon) {
    animation: hub-overview-spin 2s linear infinite;
  }
  @keyframes hub-overview-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.hub-overview .spin-icon) {
      animation: none;
    }
  }
</style>
