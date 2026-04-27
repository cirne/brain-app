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
  const mixed = $derived(files.length > 0 && choices.length > 0)
</script>

{#if show}
  <div
    class="composer-context-bar"
    role="toolbar"
    aria-label="Referenced pages and suggested replies"
    data-testid="composer-context-bar"
  >
    <div class="composer-context-bar__scroll" class:composer-context-bar__scroll--mixed={mixed}>
      {#if files.length > 0}
        <div class="composer-context-bar__group" role="group" aria-label="Referenced pages">
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
      {/if}

      {#if choices.length > 0}
        <div class="composer-context-bar__group" role="group" aria-label="Suggested replies">
          {#each choices as c, idx (c.id ?? `${idx}-${c.label}`)}
            <button
              type="button"
              class="composer-context-chip composer-context-chip--action"
              disabled={choicesDisabled || !onChoice}
              onclick={() => onChoice?.(c.submit)}
            >
              <span class="composer-context-chip__label">{c.label}</span>
              <span class="composer-context-chip__sparkle" aria-hidden="true">
                <Sparkles size={11} strokeWidth={2.25} />
              </span>
              <span class="composer-context-chip__arrow-wrap" aria-hidden="true">
                <ArrowRight size={10} strokeWidth={2.5} />
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .composer-context-bar {
    flex-shrink: 0;
    /* Match `AgentInput` .input-area horizontal padding (12px) so chips align with the shell */
    padding: 0 12px 0.5rem;
    min-height: 0;
  }

  .composer-context-bar__scroll {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem 0.5rem;
    max-width: 100%;
  }

  /**
   * Doc vs action chips are told apart by surface + border (no pipe). When both exist,
   * a touch more horizontal gap separates the two runs without forcing a second row.
   */
  .composer-context-bar__scroll--mixed {
    column-gap: 0.625rem;
  }

  /**
   * `display: contents` lets each chip participate in the parent flex row so wrapping
   * is per-chip, not “all actions on the next line” when the doc group is wide.
   */
  .composer-context-bar__group {
    display: contents;
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

  .composer-context-chip--action:hover:not(:disabled) .composer-context-chip__arrow-wrap {
    opacity: 0.9;
    transform: translateX(1px);
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }

  .composer-context-chip__arrow-wrap {
    display: inline-flex;
    flex-shrink: 0;
    opacity: 0.6;
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;
  }

  /** Hidden until hover: tiny “sparkle” affordance without stealing focus from the label. */
  .composer-context-chip__sparkle {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    margin-inline: -0.05rem;
    opacity: 0;
    transform: scale(0.88);
    color: color-mix(in srgb, var(--color-accent, #6cf) 75%, var(--color-foreground, #fff));
    filter: drop-shadow(0 0 3px color-mix(in srgb, var(--color-accent, #6cf) 35%, transparent));
    transition:
      opacity 0.2s ease,
      transform 0.2s cubic-bezier(0.34, 1.2, 0.64, 1);
    pointer-events: none;
  }

  .composer-context-chip--action:hover:not(:disabled) .composer-context-chip__sparkle {
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
    .composer-context-chip--action:hover:not(:disabled) .composer-context-chip__sparkle {
      animation: none;
      transform: scale(1);
    }

    .composer-context-chip--action:hover:not(:disabled) .composer-context-chip__arrow-wrap {
      transform: none;
    }
  }

  .composer-context-chip__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 14rem;
  }
</style>
