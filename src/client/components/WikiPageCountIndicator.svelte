<script lang="ts">
  /**
   * Shared “pages in vault” affordance: optional pulse (background wiki work) + numeric count.
   * Used in BrainHubWidget and onboarding copy that explains the same indicator.
   */
  import { BookOpen, LayoutGrid } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    /** Page count from Your Wiki doc or `/api/wiki` list length. */
    count: number | null
    /** When true, show the accent pulse dot (e.g. enrich/clean running or paused hub). */
    showPulse?: boolean
    /** Pulse ring animation — use when work is actively running, not merely paused. */
    pulseAnimating?: boolean
    /** Larger treatment for onboarding explainer. */
    size?: 'default' | 'lg'
    /**
     * When true, idle state uses a grid/hub icon instead of a book (Braintunnel Hub vs wiki home in the top bar).
     */
    hubControl?: boolean
  }

  let {
    count,
    showPulse = false,
    pulseAnimating = false,
    size = 'default',
    hubControl = false,
  }: Props = $props()

  const isLg = $derived(size === 'lg')
</script>

<div
  class={cn(
    'wiki-page-count-indicator inline-flex items-center font-medium',
    isLg
      ? 'wiki-page-count-indicator--lg gap-2.5 text-[1.25rem] text-accent [&_.wpc-book]:text-accent'
      : 'gap-2 text-[13px] text-inherit',
  )}
  role="img"
  aria-label={count != null
    ? showPulse
      ? $t('wiki.pageCountIndicator.aria.countWithActivity', { count })
      : $t('wiki.pageCountIndicator.aria.count', { count })
    : $t('wiki.pageCountIndicator.aria.loading')}
>
  {#if showPulse}
    <div
      class={cn(
        'pulse-container flex items-center justify-center',
        isLg ? 'h-[18px] w-[18px]' : 'h-[14px] w-[14px]',
      )}
    >
      <span
        class={cn(
          'pulse-dot rounded-full bg-accent',
          isLg ? 'h-2.5 w-2.5' : 'h-2 w-2',
          pulseAnimating && 'running',
        )}
      ></span>
    </div>
  {:else if hubControl}
    <LayoutGrid class="wpc-book" size={isLg ? 20 : 15} strokeWidth={2} aria-hidden="true" />
  {:else}
    <BookOpen class="wpc-book" size={isLg ? 20 : 15} strokeWidth={2} aria-hidden="true" />
  {/if}
  {#if count !== null}
    <span
      class={cn(
        'wpc-count tabular-nums',
        isLg && 'text-[1.35rem] font-semibold',
      )}
    >{count}</span>
  {/if}
</div>

<style>
  /* Keyframe-driven pulse stays scoped (Tailwind keyframes can't easily express the box-shadow ring). */
  .pulse-dot.running {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent);
    animation: wpc-pulse 2s infinite;
  }

  @keyframes wpc-pulse {
    0% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent);
    }
    70% {
      transform: scale(1);
      box-shadow: 0 0 0 6px transparent;
    }
    100% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse-dot.running {
      animation: none;
    }
  }
</style>
