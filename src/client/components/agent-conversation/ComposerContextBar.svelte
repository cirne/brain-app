<script lang="ts">
  import { ArrowRight, Sparkles } from 'lucide-svelte'
  import WikiFileName from '@components/WikiFileName.svelte'
  import { cn } from '@client/lib/cn.js'
  import type { QuickReplyChoice } from '@client/lib/tools/suggestReplyChoices.js'

  let {
    files,
    choices,
    onOpenWiki,
    onChoice,
    choicesDisabled = false,
  }: {
    files: string[]
    choices: QuickReplyChoice[]
    onOpenWiki?: (_path: string) => void
    onChoice?: (_choice: QuickReplyChoice) => void
    /** When true, action chips are non-interactive (e.g. while streaming). */
    choicesDisabled?: boolean
  } = $props()

  const show = $derived(files.length > 0 || choices.length > 0)

  const chipClass =
    'composer-context-chip inline-flex max-w-full items-center gap-[0.35rem] rounded-full border border-border px-[0.55rem] py-[0.2rem] font-[inherit] text-xs leading-[1.25] transition-[border-color,background,box-shadow] duration-[180ms] ease-in-out disabled:cursor-not-allowed disabled:opacity-[0.55] max-md:min-h-11 max-md:gap-[0.45rem] max-md:px-3 max-md:py-[0.35rem] max-md:text-sm max-md:leading-[1.3]'
</script>

{#if show}
  <div
    class="composer-context-bar relative min-h-0 shrink-0 bg-[color-mix(in_srgb,var(--bg-2,#111)_30%,transparent)] px-3 pt-0 pb-2 pointer-events-auto max-md:pb-2.5"
    role="toolbar"
    aria-label="Referenced pages and suggested replies"
    data-testid="composer-context-bar"
  >
    {#if files.length > 0}
      <div class="composer-context-bar__refs-wrap overflow-hidden">
        <div
          class="composer-context-bar__refs flex max-w-full flex-nowrap items-center gap-x-2 gap-y-1.5 overflow-x-auto [scrollbar-width:none] [-webkit-overflow-scrolling:touch] max-md:gap-x-2.5 max-md:gap-y-2"
          role="group"
          aria-label="Referenced pages"
        >
          {#each files as path (path)}
            <button
              type="button"
              class={cn(chipClass, 'composer-context-chip--doc shrink-0 bg-surface-3 text-inherit')}
              onclick={() => onOpenWiki?.(path)}
            >
              <WikiFileName {path} />
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if choices.length > 0}
      <div
        class={cn(
          'composer-context-bar__actions flex max-w-full flex-wrap items-center gap-x-2 gap-y-1.5 max-md:gap-x-2.5 max-md:gap-y-2',
          files.length > 0 && 'mt-1.5',
        )}
        role="group"
        aria-label="Suggested replies"
      >
        {#each choices as c, idx (c.id ?? `${idx}-${c.label}`)}
          <button
            type="button"
            class={cn(chipClass, 'composer-context-chip--action bg-accent-dim')}
            disabled={choicesDisabled || !onChoice}
            onclick={() => onChoice?.(c)}
          >
            <span class="composer-context-chip__label min-w-0 max-w-56 overflow-hidden text-ellipsis whitespace-nowrap">
              {c.label}
            </span>
            <span
              class="composer-context-chip__icon-slot relative h-[var(--composer-context-icon-size,12px)] w-[var(--composer-context-icon-size,12px)] shrink-0 max-md:[--composer-context-icon-size:14px]"
              aria-hidden="true"
            >
              <span
                class="composer-context-chip__icon composer-context-chip__icon--arrow pointer-events-none absolute inset-0 inline-flex items-center justify-center opacity-60 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.34,1.2,0.64,1)]"
              >
                <ArrowRight size={12} strokeWidth={2.5} />
              </span>
              <span
                class="composer-context-chip__icon composer-context-chip__icon--sparkle pointer-events-none absolute inset-0 inline-flex scale-[0.88] items-center justify-center opacity-0 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.34,1.2,0.64,1)]"
              >
                <Sparkles size={12} strokeWidth={2.25} />
              </span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  /**
   * Fade the right edge of the refs row (alpha mask), not a solid overlay.
   */
  .composer-context-bar__refs {
    -webkit-mask-image: linear-gradient(
      to right,
      #000 0%,
      #000 calc(100% - 2rem),
      transparent 100%
    );
    mask-image: linear-gradient(to right, #000 0%, #000 calc(100% - 2rem), transparent 100%);
  }

  .composer-context-bar__refs::-webkit-scrollbar {
    display: none;
  }

  .composer-context-chip--doc:hover:not(:disabled) {
    background: var(--color-surface-3, #2a2a2a);
    border-color: var(--color-accent, #6cf);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-accent, #6cf) 55%, transparent),
      0 0 10px color-mix(in srgb, var(--color-accent, #6cf) 18%, transparent);
  }

  .composer-context-chip--action {
    border-color: color-mix(in srgb, var(--color-accent, #6cf) 35%, var(--color-border, #333));
  }

  .composer-context-chip--action:hover:not(:disabled) {
    border-color: var(--color-accent, #6cf);
    background: color-mix(in srgb, var(--color-accent-dim, rgba(100, 200, 255, 0.15)) 100%, transparent);
  }

  .composer-context-chip__icon :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .composer-context-chip__icon--sparkle {
    color: color-mix(in srgb, var(--color-accent, #6cf) 75%, var(--color-foreground, #fff));
    filter: drop-shadow(0 0 3px color-mix(in srgb, var(--color-accent, #6cf) 35%, transparent));
  }

  .composer-context-chip--action:is(:hover, :focus-visible):not(:disabled) .composer-context-chip__icon--arrow {
    opacity: 0;
  }

  .composer-context-chip--action:is(:hover, :focus-visible):not(:disabled) .composer-context-chip__icon--sparkle {
    opacity: 0.88;
    transform: scale(1);
    animation: composer-context-sparkle-nudge 0.55s ease-out 1 both;
  }

  @keyframes composer-context-sparkle-nudge {
    0%   { transform: scale(0.92) rotate(-6deg); }
    40%  { transform: scale(1.06) rotate(4deg); }
    70%  { transform: scale(0.98) rotate(-2deg); }
    100% { transform: scale(1) rotate(0deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .composer-context-chip--action:is(:hover, :focus-visible):not(:disabled) .composer-context-chip__icon--sparkle {
      animation: none;
      transform: scale(1);
    }
  }
</style>
