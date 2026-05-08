<script lang="ts">
  import { ChevronDown, ChevronRight } from 'lucide-svelte'
  import type { BrainAccessGrantRow } from '@client/lib/brainAccessPolicyGrouping.js'

  type Props = {
    grantedToMe: BrainAccessGrantRow[]
  }

  let { grantedToMe }: Props = $props()

  let expanded = $state(false)
</script>

<section class="flex flex-col gap-3" aria-labelledby="brain-access-outbound-heading">
  <button
    type="button"
    id="brain-access-outbound-heading"
    class="flex w-full items-center justify-between border-none bg-transparent p-0 text-left [font:inherit]"
    onclick={() => (expanded = !expanded)}
    aria-expanded={expanded}
  >
    <span class="text-[0.9375rem] font-bold tracking-[0.02em] text-foreground">Brains you can ask</span>
    {#if expanded}
      <ChevronDown size={18} class="shrink-0 text-muted" aria-hidden="true" />
    {:else}
      <ChevronRight size={18} class="shrink-0 text-muted" aria-hidden="true" />
    {/if}
  </button>
  {#if !expanded}
    <p class="m-0 text-[0.8125rem] text-muted">
      {grantedToMe.length === 0
        ? 'No access yet.'
        : `${grantedToMe.length} brain${grantedToMe.length === 1 ? '' : 's'} — tap to expand`}
    </p>
  {:else if grantedToMe.length === 0}
    <p class="m-0 text-[0.8125rem] text-muted">No one has shared their brain with you yet.</p>
  {:else}
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      {#each grantedToMe as row (row.id)}
        <li
          class="rounded-lg border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-2 px-3 py-2 text-[0.875rem]"
        >
          <span class="font-medium font-mono">@{row.ownerHandle}</span>
          <span class="text-muted"> — mention them in chat to ask their brain a question.</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
