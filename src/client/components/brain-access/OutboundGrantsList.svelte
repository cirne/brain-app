<script lang="ts">
  import { X } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'
  import type { BrainAccessCustomPolicy } from '@client/lib/brainAccessCustomPolicies.js'
  import {
    classifyGrantPolicy,
    type BrainAccessGrantRow,
  } from '@client/lib/brainAccessPolicyGrouping.js'

  type Props = {
    grantedToMe: BrainAccessGrantRow[]
    customPolicies: BrainAccessCustomPolicy[]
    onRemoveInbound?: (_grantId: string) => void
    removeBusyId?: string | null
  }

  let { grantedToMe, customPolicies, onRemoveInbound, removeBusyId = null }: Props = $props()
</script>

<section class="flex flex-col gap-2" aria-labelledby="brain-access-outbound-heading">
  <h2
    id="brain-access-outbound-heading"
    class="m-0 text-[0.9375rem] font-bold tracking-[0.02em] text-foreground"
  >
    {$t('access.outboundGrantsList.heading')}
  </h2>
  <p class="m-0 max-w-[42rem] text-[0.8125rem] leading-relaxed text-muted">
    {$t('access.outboundGrantsList.description')}
  </p>
  {#if grantedToMe.length === 0}
    <p class="m-0 text-[0.8125rem] text-muted">{$t('access.outboundGrantsList.empty')}</p>
  {:else}
    <ul class="m-0 flex list-none flex-wrap gap-2 p-0">
      {#each grantedToMe as row (row.id)}
        {@const meta = classifyGrantPolicy(row, customPolicies)}
        <li
          class="inline-flex max-w-full items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-2 py-1.5 pl-3 pr-1 text-[0.8125rem] text-foreground"
        >
          <span class="truncate font-medium font-mono">@{row.ownerHandle}</span>
          <span class="shrink-0 text-muted" aria-hidden="true">·</span>
          <span class="min-w-0 shrink truncate text-muted">{meta.label}</span>
          {#if onRemoveInbound}
            <button
              type="button"
              class="ml-0.5 inline-flex shrink-0 items-center justify-center rounded-full p-1 text-muted hover:bg-surface-3 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-label={$t('access.outboundGrantsList.removeAria', { handle: row.ownerHandle })}
              disabled={removeBusyId === row.id}
              onclick={() => onRemoveInbound(row.id)}
            >
              <X size={14} strokeWidth={2.25} aria-hidden="true" />
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
