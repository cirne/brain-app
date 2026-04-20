<script lang="ts">
  import type { Snippet } from 'svelte'
  import './onboardingHeroPrimitives.css'

  let {
    indexing = false,
    heroClass = '',
    innerClass = '',
    ariaBusy,
    children,
  }: {
    indexing?: boolean
    heroClass?: string
    innerClass?: string
    /** Sets `aria-busy` on the outer hero (e.g. indexing step). */
    ariaBusy?: boolean | 'true' | 'false'
    children: Snippet
  } = $props()
</script>

<div
  class={['ob-hero', heroClass].filter(Boolean).join(' ')}
  class:ob-hero--indexing={indexing}
  aria-busy={ariaBusy}
>
  <div
    class={['ob-hero-inner', indexing && 'ob-indexing-hero-inner', innerClass].filter(Boolean).join(' ')}
  >
    {@render children()}
  </div>
</div>

<style>
  /* Centered full-height onboarding step column */
  .ob-hero {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-height: min(560px, 85vh);
    padding: 3.5rem 1.5rem;
  }
  @media (min-width: 640px) {
    .ob-hero {
      padding: 4rem 2rem;
    }
  }
  .ob-hero-inner {
    width: 100%;
    max-width: 28rem;
    text-align: center;
  }

  /**
   * Indexing: inner column grows/shrinks with status slot; outer hero participates in flex parent.
   */
  .ob-hero--indexing {
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 0;
  }

  .ob-indexing-hero-inner {
    max-width: 22rem;
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
</style>
