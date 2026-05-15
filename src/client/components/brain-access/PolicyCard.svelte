<script lang="ts">
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import type { PolicyCardModel } from '@client/lib/brainAccessPolicyGrouping.js'
  import AddUserDropdown from './AddUserDropdown.svelte'
  import UserBubble from './UserBubble.svelte'
  import { policyCardTone } from './policyColors.js'
  import type { WorkspaceHandleEntry } from '@client/lib/workspaceHandleSuggest.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    model: PolicyCardModel
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    onAddUser: (_model: PolicyCardModel, _entry: WorkspaceHandleEntry) => void | Promise<void>
    onRemoveGrant: (_grantId: string) => void | Promise<void>
    onOpenChangePolicy: (_grantId: string) => void
    removeBusyId?: string | null
    addBusy?: boolean
  }

  let {
    model,
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
  role="link"
  tabindex="0"
  class={[
    'policy-card group flex cursor-pointer flex-col gap-2 rounded-lg border-l-4 bg-surface px-3 py-3 outline-none transition-colors hover:bg-surface-2/80 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
    tone.bar,
    tone.ring,
    tone.softBg,
  ]}
  aria-label={$t('access.policyCard.ariaOpenPolicy', { label: model.label })}
  onclick={(e) => {
    const t = e.target as HTMLElement | null
    if (t && t.closest('[data-policy-card-stop]')) return
    onSettingsNavigate({ type: 'brain-access-policy', policyId: model.policyId })
  }}
  onkeydown={(e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const t = e.target as HTMLElement | null
    if (t && t.closest('[data-policy-card-stop]')) return
    e.preventDefault()
    onSettingsNavigate({ type: 'brain-access-policy', policyId: model.policyId })
  }}
>
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div class="min-w-0 flex-1 flex flex-col gap-0.5">
      <h3 class="m-0 text-[0.875rem] font-bold uppercase tracking-[0.04em] leading-tight text-foreground">
        {model.label}
      </h3>
      {#if model.hint}
        <p class="m-0 max-w-[42rem] text-[0.8125rem] leading-tight text-muted">{model.hint}</p>
      {/if}
    </div>
    <div class="shrink-0 self-start" data-policy-card-stop>
      <AddUserDropdown
        excludeHandles={excludeHandles}
        disabled={addBusy}
        busy={addBusy}
        onPick={(entry) => void onAddUser(model, entry)}
      />
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-1.5" data-policy-card-stop>
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
  </div>

</div>
