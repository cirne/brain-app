<script lang="ts">
  import { Lock } from 'lucide-svelte'
  import type { OnboardingLeadBlock } from '@client/lib/onboarding/onboardingLeadCopy.js'

  let { title, lead, hideTitle = false }: OnboardingLeadBlock & { hideTitle?: boolean } = $props()
</script>

<header
  class="flex items-start gap-3 [font:inherit]"
  aria-labelledby={hideTitle ? undefined : "ob-local-wiki-title"}
>
  <div
    class="flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-surface-3 text-accent [font:inherit]"
    aria-hidden="true"
  >
    <Lock size={20} strokeWidth={2} />
  </div>
  <div class="min-w-0 flex-1 [&_.ob-prof-title]:mb-1.5 [font:inherit]">
    {#if !hideTitle}
      <h1 id="ob-local-wiki-title" class="ob-prof-title">{title}</h1>
    {/if}
    <p class="ob-prof-lead">{lead}</p>
  </div>
</header>
