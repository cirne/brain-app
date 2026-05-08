<script lang="ts">
  import { ChevronRight } from 'lucide-svelte'

  type Props = {
    variant: 'list' | 'policy' | 'preview'
    /** Display name for the policy (policy + preview variants). */
    policyLabel?: string
    /** Navigate to the Brain access list (policy + preview). */
    onGoToList?: () => void
    /** Preview only: open policy detail. */
    onGoToPolicy?: () => void
  }

  let { variant, policyLabel = 'Policy', onGoToList, onGoToPolicy }: Props = $props()

  const crumbClass =
    'border-none bg-transparent p-0 text-[0.8125rem] font-semibold text-accent [font:inherit] hover:underline'
</script>

<nav aria-label="Brain access" class="min-w-0">
  <ol class="m-0 flex min-w-0 list-none flex-wrap items-center gap-x-1 gap-y-1 p-0 text-[0.8125rem]">
    {#if variant === 'list'}
      <li class="truncate font-semibold text-foreground" aria-current="page">Brain to Brain access</li>
    {:else}
      <li class="min-w-0 shrink">
        <button type="button" class={crumbClass} onclick={() => onGoToList?.()}>Brain to Brain access</button>
      </li>
      <li class="flex shrink-0 items-center text-muted" aria-hidden="true">
        <ChevronRight size={14} />
      </li>
      {#if variant === 'policy'}
        <li class="min-w-0 truncate font-semibold text-foreground" aria-current="page">{policyLabel}</li>
      {:else}
        <li class="min-w-0 shrink">
          <button
            type="button"
            class={crumbClass}
            onclick={() => onGoToPolicy?.()}
            disabled={!onGoToPolicy}
          >
            {policyLabel}
          </button>
        </li>
        <li class="flex shrink-0 items-center text-muted" aria-hidden="true">
          <ChevronRight size={14} />
        </li>
        <li class="truncate font-semibold text-foreground" aria-current="page">Test policy</li>
      {/if}
    {/if}
  </ol>
</nav>
