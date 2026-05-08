<script lang="ts">
  import { ChevronRight } from 'lucide-svelte'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import type { PolicyCardModel } from '@client/lib/brainAccessPolicyGrouping.js'
  import AddUserDropdown from './AddUserDropdown.svelte'
  import UserBubble from './UserBubble.svelte'
  import { policyCardTone } from './policyColors.js'
  import type { WorkspaceHandleEntry } from '@client/lib/workspaceHandleSuggest.js'

  type Props = {
    model: PolicyCardModel
    /** Rows in recent owner log attributable to this policy (server log slice). */
    policyActivityCount: number
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    onAddUser: (_policyCanonicalText: string, _entry: WorkspaceHandleEntry) => void | Promise<void>
    onRemoveGrant: (_grantId: string) => void | Promise<void>
    onOpenChangePolicy: (_grantId: string) => void
    removeBusyId?: string | null
    addBusy?: boolean
  }

  let {
    model,
    policyActivityCount,
    onSettingsNavigate,
    onAddUser,
    onRemoveGrant,
    onOpenChangePolicy,
    removeBusyId = null,
    addBusy = false,
  }: Props = $props()

  const tone = $derived(
    policyCardTone({
      kind: model.kind,
      builtinId: model.builtinId,
      colorIndex: model.colorIndex,
      policyId: model.policyId,
    }),
  )

  /** Handles on this card — exclude from directory picker */
  const excludeHandles = $derived(
    new Set(
      model.grants
        .map((g) => (g.askerHandle ?? '').toLowerCase())
        .filter((h) => h.length > 0),
    ),
  )

</script>

<div
  class={[
    'policy-card flex flex-col gap-3 rounded-lg border-l-4 bg-surface p-4',
    tone.bar,
    tone.ring,
    tone.softBg,
  ]}
>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0 flex-1 flex flex-col gap-1">
      <h3 class="m-0 text-[0.9375rem] font-bold uppercase tracking-[0.04em] text-foreground">
        {model.label}
      </h3>
      {#if model.hint}
        <p class="m-0 max-w-[42rem] text-[0.8125rem] leading-snug text-muted">{model.hint}</p>
      {/if}
    </div>
    <button
      type="button"
      class="inline-flex shrink-0 items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-3 py-1.5 text-[0.8125rem] font-semibold text-foreground hover:bg-surface-2"
      onclick={() => onSettingsNavigate({ type: 'brain-access-policy', policyId: model.policyId })}
    >
      View
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    {#each model.grants as grant (grant.id)}
      <UserBubble
        grantId={grant.id}
        handle={grant.askerHandle ?? grant.askerId}
        policyIdForDetail={model.policyId}
        {onSettingsNavigate}
        onChangePolicy={() => onOpenChangePolicy(grant.id)}
        onRemove={() => void onRemoveGrant(grant.id)}
        removeBusy={removeBusyId === grant.id}
      />
    {/each}
    <AddUserDropdown
      excludeHandles={excludeHandles}
      disabled={addBusy}
      busy={addBusy}
      onPick={(entry) => void onAddUser(model.canonicalText, entry)}
    />
  </div>

  <p class="m-0 text-[0.75rem] font-medium text-muted">
    {model.grants.length} collaborator{model.grants.length === 1 ? '' : 's'} · {policyActivityCount} recent
    inbound quer{policyActivityCount === 1 ? 'y' : 'ies'} (loaded log)
  </p>
</div>
