<script lang="ts">
  import { ArrowRight, Sparkles } from 'lucide-svelte'
  import WikiFileName from '../WikiFileName.svelte'
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
    onChoice?: (_submit: string) => void
    /** When true, action chips are non-interactive (e.g. while streaming). */
    choicesDisabled?: boolean
  } = $props()

  const show = $derived(files.length > 0 || choices.length > 0)
</script>

{#if show}
  <div
    class="composer-context-bar"
    role="toolbar"
    aria-label="Referenced pages and suggested replies"
    data-testid="composer-context-bar"
  >
    {#if files.length > 0}
      <div class="composer-context-bar__refs-wrap">
        <div class="composer-context-bar__refs" role="group" aria-label="Referenced pages">
          {#each files as path (path)}
            <button
              type="button"
              class="composer-context-chip composer-context-chip--doc"
              onclick={() => onOpenWiki?.(path)}
            >
              <WikiFileName {path} />
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if choices.length > 0}
      <div class="composer-context-bar__actions" role="group" aria-label="Suggested replies">
        {#each choices as c, idx (c.id ?? `${idx}-${c.label}`)}
          <button
            type="button"
            class="composer-context-chip composer-context-chip--action"
            disabled={choicesDisabled || !onChoice}
            onclick={() => onChoice?.(c.submit)}
          >
            <span class="composer-context-chip__label">{c.label}</span>
            <span class="composer-context-chip__icon-slot" aria-hidden="true">
              <span class="composer-context-chip__icon composer-context-chip__icon--arrow">
                <ArrowRight size={12} strokeWidth={2.5} />
              </span>
              <span class="composer-context-chip__icon composer-context-chip__icon--sparkle">
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
  .composer-context-bar {
    /* Positioned by the .context-bar-overlay wrapper in AgentChat; this element fills that box */
    position: relative;
    flex-shrink: 0;
    /* 80% transparent backdrop so transcript text shows through with a subtle tint */
    background: color-mix(in srgb, var(--bg-2, #111) 20%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    /* Match `AgentInput` .input-area horizontal padding (12px) so chips align with the shell */
    padding: 0 12px 0.5rem;
    min-height: 0;
    pointer-events: auto;
  }

  .composer-context-bar__refs-wrap {
    overflow: hidden;
  }

  /**
   * Fade the right edge of the refs row (alpha mask), not a solid overlay — avoids wrong
   * theme colors: `--color-background` / `--color-surface-1` are not defined in style.css,
   * so the old gradient fell through to `#111` and looked black in light mode.
   */
  .composer-context-bar__refs {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.375rem 0.5rem;
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
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

  .composer-context-bar__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem 0.5rem;
    max-width: 100%;
  }

  .composer-context-bar__actions:not(:first-child) {
    margin-top: 0.375rem;
  }

  .composer-context-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    border-radius: 9999px;
    border: 1px solid var(--color-border, #333);
    padding: 0.2rem 0.55rem;
    font: inherit;
    font-size: 0.75rem;
    line-height: 1.25;
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      background 0.18s ease,
      box-shadow 0.18s ease;
  }

  .composer-context-chip:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .composer-context-chip--doc {
    background: var(--color-surface-3, #2a2a2a);
    color: inherit;
    flex-shrink: 0;
  }

  /** Doc chips: hover = ring/outline only so they stay visually distinct from accent-filled actions. */
  .composer-context-chip--doc:hover:not(:disabled) {
    background: var(--color-surface-3, #2a2a2a);
    border-color: var(--color-accent, #6cf);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--color-accent, #6cf) 55%, transparent),
      0 0 10px color-mix(in srgb, var(--color-accent, #6cf) 18%, transparent);
  }

  .composer-context-chip--action {
    background: var(--color-accent-dim, rgba(100, 200, 255, 0.1));
    border-color: color-mix(in srgb, var(--color-accent, #6cf) 35%, var(--color-border, #333));
  }

  .composer-context-chip--action:hover:not(:disabled) {
    border-color: var(--color-accent, #6cf);
    background: color-mix(in srgb, var(--color-accent-dim, rgba(100, 200, 255, 0.15)) 100%, transparent);
  }

  /**
   * Single fixed box: arrow by default, sparkle on hover/focus — same footprint so the chip width
   * does not change.
   */
  .composer-context-chip__icon-slot {
    position: relative;
    flex-shrink: 0;
    width: var(--composer-context-icon-size, 12px);
    height: var(--composer-context-icon-size, 12px);
  }

  .composer-context-chip__icon {
    position: absolute;
    inset: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    transition:
      opacity 0.2s ease,
      transform 0.2s cubic-bezier(0.34, 1.2, 0.64, 1);
  }

  .composer-context-chip__icon :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .composer-context-chip__icon--arrow {
    opacity: 0.6;
  }

  .composer-context-chip__icon--sparkle {
    opacity: 0;
    transform: scale(0.88);
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
    0% {
      transform: scale(0.92) rotate(-6deg);
    }
    40% {
      transform: scale(1.06) rotate(4deg);
    }
    70% {
      transform: scale(0.98) rotate(-2deg);
    }
    100% {
      transform: scale(1) rotate(0deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .composer-context-chip--action:is(:hover, :focus-visible):not(:disabled) .composer-context-chip__icon--sparkle {
      animation: none;
      transform: scale(1);
    }
  }

  .composer-context-chip__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 14rem;
  }

  /* Finger-sized targets on small viewports only (matches `--tab-h` / mobile :root tweaks in style.css). */
  @media (max-width: 768px) {
    .composer-context-bar {
      padding-bottom: 0.625rem;
    }

    .composer-context-bar__refs,
    .composer-context-bar__actions {
      gap: 0.5rem 0.625rem;
    }

    .composer-context-chip {
      min-height: 44px;
      padding: 0.35rem 0.75rem;
      font-size: 0.875rem;
      line-height: 1.3;
      gap: 0.45rem;
    }

    .composer-context-chip__icon-slot {
      --composer-context-icon-size: 14px;
    }
  }
</style>
