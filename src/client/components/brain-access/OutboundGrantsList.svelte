<script lang="ts">
  import type { BrainAccessCustomPolicy } from '@client/lib/brainAccessCustomPolicies.js'
  import {
    classifyGrantPolicy,
    type BrainAccessGrantRow,
  } from '@client/lib/brainAccessPolicyGrouping.js'

  type Props = {
    grantedToMe: BrainAccessGrantRow[]
    customPolicies: BrainAccessCustomPolicy[]
  }

  let { grantedToMe, customPolicies }: Props = $props()
</script>

<section class="flex flex-col gap-2" aria-labelledby="brain-access-outbound-heading">
  <h2
    id="brain-access-outbound-heading"
    class="m-0 text-[0.9375rem] font-bold tracking-[0.02em] text-foreground"
  >
    Brains you can ask
  </h2>
  {#if grantedToMe.length === 0}
    <p class="m-0 text-[0.8125rem] text-muted">No access yet.</p>
  {:else}
    <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
      {#each grantedToMe as row (row.id)}
        {@const meta = classifyGrantPolicy(row.privacyPolicy, customPolicies)}
        <li
          class="inline-flex max-w-full items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-2 px-3 py-1.5 text-[0.8125rem] text-foreground"
        >
          <span class="truncate font-medium font-mono">@{row.ownerHandle}</span>
          <span class="shrink-0 text-muted" aria-hidden="true">·</span>
          <span class="min-w-0 truncate text-muted">{meta.label}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
