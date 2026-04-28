<script lang="ts">
  import { ArrowRight } from 'lucide-svelte'
  import type { SuggestionSet } from '@shared/suggestions.js'

  let {
    suggestionSet = null as SuggestionSet | null,
    loading = false,
    disabled = false,
    onSubmit,
  }: {
    suggestionSet: SuggestionSet | null
    loading?: boolean
    disabled?: boolean
    onSubmit?: (_text: string) => void
  } = $props()

  /** Selected `submit` string for radio group */
  let radioSubmit = $state<string | null>(null)
  /** Checkbox id → checked */
  let checkboxState = $state<Record<string, boolean>>({})

  $effect(() => {
    suggestionSet
    radioSubmit = null
    checkboxState = {}
  })

  const show = $derived(loading || suggestionSet != null)

  function submitRadio() {
    const s = radioSubmit
    if (!s || disabled || !onSubmit) return
    onSubmit(s)
  }

  function submitCheckboxes(set: Extract<SuggestionSet, { type: 'checkboxes' }>) {
    const labels = set.items.filter((i) => checkboxState[i.id]).map((i) => i.label)
    if (labels.length === 0 || disabled || !onSubmit) return
    onSubmit(`${set.submitPrefix}: ${labels.join(', ')}`)
  }
</script>

{#if show}
  <div
    class="suggestion-widget"
    role="region"
    aria-label="Suggested next steps"
    data-testid="suggestion-widget"
  >
    {#if loading && !suggestionSet}
      <div class="suggestion-widget__skeleton" aria-busy="true">
        <span class="suggestion-widget__sk-chip"></span>
        <span class="suggestion-widget__sk-chip"></span>
        <span class="suggestion-widget__sk-chip"></span>
      </div>
    {:else if suggestionSet?.type === 'chips'}
      <div class="suggestion-widget__scroll">
        <div class="suggestion-widget__group" role="group" aria-label="Quick replies">
          {#each suggestionSet.choices as c, idx (c.id ?? `${idx}-${c.label}`)}
            <button
              type="button"
              class="composer-context-chip composer-context-chip--action"
              disabled={disabled || !onSubmit}
              onclick={() => onSubmit?.(c.submit)}
            >
              <span class="composer-context-chip__label">{c.label}</span>
              <span class="composer-context-chip__icon-slot" aria-hidden="true">
                <span class="composer-context-chip__icon composer-context-chip__icon--arrow">
                  <ArrowRight size={12} strokeWidth={2.5} />
                </span>
              </span>
            </button>
          {/each}
        </div>
      </div>
    {:else if suggestionSet?.type === 'radio'}
      {@const set = suggestionSet}
      <fieldset class="suggestion-widget__fieldset">
        {#if set.prompt}
          <legend class="suggestion-widget__legend">{set.prompt}</legend>
        {/if}
        <div class="suggestion-widget__radio-list" role="radiogroup" aria-label={set.prompt ?? 'Choose one'}>
          {#each set.choices as c, idx (c.id ?? `r-${idx}-${c.label}`)}
            <label class="suggestion-widget__radio-row">
              <input type="radio" name="suggestion-radio" bind:group={radioSubmit} value={c.submit} />
              <span>{c.label}</span>
            </label>
          {/each}
        </div>
        <button
          type="button"
          class="suggestion-widget__send-btn"
          disabled={disabled || !radioSubmit || !onSubmit}
          onclick={() => submitRadio()}
        >
          Send
        </button>
      </fieldset>
    {:else if suggestionSet?.type === 'checkboxes'}
      {@const set = suggestionSet}
      <fieldset class="suggestion-widget__fieldset">
        {#if set.prompt}
          <legend class="suggestion-widget__legend">{set.prompt}</legend>
        {/if}
        <div class="suggestion-widget__check-list">
          {#each set.items as item (item.id)}
            <label class="suggestion-widget__check-row">
              <input
                type="checkbox"
                checked={checkboxState[item.id] === true}
                onchange={(e) => {
                  const el = e.currentTarget as HTMLInputElement
                  checkboxState = { ...checkboxState, [item.id]: el.checked }
                }}
              />
              <span>{item.label}</span>
            </label>
          {/each}
        </div>
        <button
          type="button"
          class="suggestion-widget__send-btn"
          disabled={disabled || !onSubmit}
          onclick={() => submitCheckboxes(set)}
        >
          Send
        </button>
      </fieldset>
    {/if}
  </div>
{/if}

<style>
  .suggestion-widget {
    flex-shrink: 0;
    padding: 0 12px 0.5rem;
    min-height: 0;
  }

  .suggestion-widget__scroll {
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: thin;
  }

  .suggestion-widget__group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    min-height: 28px;
  }

  .suggestion-widget__skeleton {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    min-height: 28px;
  }

  .suggestion-widget__sk-chip {
    display: inline-block;
    height: 28px;
    width: 72px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--color-fg, #ccc) 12%, transparent);
    animation: suggestion-pulse 1.2s ease-in-out infinite;
  }

  @keyframes suggestion-pulse {
    50% {
      opacity: 0.55;
    }
  }

  /* Reuse chip look from ComposerContextBar (class names copied) */
  :global(.suggestion-widget .composer-context-chip) {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    padding: 0.25rem 0.6rem 0.25rem 0.75rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--color-fg, #ccc) 22%, transparent);
    background: color-mix(in srgb, var(--color-fg, #ccc) 6%, transparent);
    font-size: 0.8125rem;
    line-height: 1.25;
    cursor: pointer;
    color: inherit;
  }

  :global(.suggestion-widget .composer-context-chip:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  :global(.suggestion-widget .composer-context-chip__label) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .suggestion-widget__fieldset {
    border: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .suggestion-widget__legend {
    padding: 0;
    font-size: 0.8125rem;
    font-weight: 500;
    margin-bottom: 0.15rem;
  }

  .suggestion-widget__radio-list,
  .suggestion-widget__check-list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.8125rem;
  }

  .suggestion-widget__radio-row,
  .suggestion-widget__check-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .suggestion-widget__send-btn {
    align-self: flex-start;
    padding: 0.35rem 0.75rem;
    font-size: 0.8125rem;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--color-fg, #ccc) 28%, transparent);
    background: color-mix(in srgb, var(--color-fg, #ccc) 8%, transparent);
    cursor: pointer;
    color: inherit;
  }

  .suggestion-widget__send-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
