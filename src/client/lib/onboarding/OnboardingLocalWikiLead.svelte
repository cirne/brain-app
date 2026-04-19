<script lang="ts">
  import { Lock } from 'lucide-svelte'
  import type { OnboardingLeadBlock } from './onboardingLeadCopy.js'

  let { title, lead, hideTitle = false }: OnboardingLeadBlock & { hideTitle?: boolean } = $props()
</script>

<header class="ob-local-wiki-lead" aria-labelledby={hideTitle ? undefined : "ob-local-wiki-title"}>
  <div class="ob-local-wiki-lead-icon" aria-hidden="true">
    <Lock size={20} strokeWidth={2} />
  </div>
  <div class="ob-local-wiki-lead-text">
    {#if !hideTitle}
      <h1 id="ob-local-wiki-title" class="ob-prof-title">{title}</h1>
    {/if}
    <p class="ob-prof-lead">{lead}</p>
  </div>
</header>

<style>
  .ob-local-wiki-lead {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    margin-bottom: 1rem;
  }

  .ob-local-wiki-lead-icon {
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-3);
    border: 1px solid var(--border);
    color: var(--accent);
  }

  .ob-local-wiki-lead-text {
    min-width: 0;
    flex: 1;
  }

  .ob-local-wiki-lead-text :global(.ob-prof-title) {
    margin-bottom: 0.4rem;
  }
</style>
