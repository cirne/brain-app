<script lang="ts">
  /**
   * Shared “pages in vault” affordance: optional pulse (background wiki work) + numeric count.
   * Used in BrainHubWidget and onboarding copy that explains the same indicator.
   */
  import { BookOpen } from 'lucide-svelte'

  type Props = {
    /** Page count from Your Wiki doc or `/api/wiki` list length. */
    count: number | null
    /** When true, show the accent pulse dot (e.g. enrich/clean running or paused hub). */
    showPulse?: boolean
    /** Pulse ring animation — use when work is actively running, not merely paused. */
    pulseAnimating?: boolean
    /** Larger treatment for onboarding explainer. */
    size?: 'default' | 'lg'
  }

  let {
    count,
    showPulse = false,
    pulseAnimating = false,
    size = 'default',
  }: Props = $props()
</script>

<div
  class="wiki-page-count-indicator"
  class:wiki-page-count-indicator--lg={size === 'lg'}
  role="img"
  aria-label={count != null
    ? `${count} page${count === 1 ? '' : 's'} in wiki${showPulse ? ', background activity' : ''}`
    : 'Wiki page count loading'}
>
  {#if showPulse}
    <div class="pulse-container">
      <span class="pulse-dot" class:running={pulseAnimating}></span>
    </div>
  {:else}
    <BookOpen class="wpc-book" size={size === 'lg' ? 20 : 15} strokeWidth={2} aria-hidden="true" />
  {/if}
  {#if count !== null}
    <span class="wpc-count">{count}</span>
  {/if}
</div>

<style>
  .wiki-page-count-indicator {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: inherit;
    font-size: 13px;
    font-weight: 500;
  }

  .wiki-page-count-indicator--lg {
    gap: 10px;
    font-size: 1.25rem;
    color: var(--accent);
  }

  :global(.wiki-page-count-indicator--lg .wpc-book) {
    color: var(--accent);
  }

  .wpc-count {
    font-variant-numeric: tabular-nums;
  }

  .wiki-page-count-indicator--lg .wpc-count {
    font-size: 1.35rem;
    font-weight: 600;
  }

  .pulse-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
  }

  .wiki-page-count-indicator--lg .pulse-container {
    width: 18px;
    height: 18px;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }

  .wiki-page-count-indicator--lg .pulse-dot {
    width: 10px;
    height: 10px;
  }

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
