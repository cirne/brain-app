<script lang="ts">
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import type { PolicyCardModel } from '@client/lib/brainAccessPolicyGrouping.js'
  import AddUserDropdown from './AddUserDropdown.svelte'
  import UserBubble from './UserBubble.svelte'
  import { policyCardTone } from './policyColors.js'
  import type { WorkspaceHandleEntry } from '@client/lib/workspaceHandleSuggest.js'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'

  type PolicyCardVariant = 'manage' | 'select'

  type Props = {
    model: PolicyCardModel
    /** `manage` (default): open policy detail + collaborators. `select`: radio row in a picker. */
    variant?: PolicyCardVariant
    onSettingsNavigate?: (_overlay: Overlay, _opts?: NavigateOptions) => void
    onAddUser?: (_model: PolicyCardModel, _entry: WorkspaceHandleEntry) => void | Promise<void>
    onRemoveGrant?: (_grantId: string) => void | Promise<void>
    onOpenChangePolicy?: (_grantId: string) => void
    removeBusyId?: string | null
    addBusy?: boolean
    selected?: boolean
    disabled?: boolean
    radioName?: string
    onSelect?: (_policyId: string) => void
  }

  let {
    model,
    variant = 'manage',
    onSettingsNavigate,
    onAddUser,
    onRemoveGrant,
    onOpenChangePolicy,
    removeBusyId = null,
    addBusy = false,
    selected = false,
    disabled = false,
    radioName = '',
    onSelect,
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

  function openPolicyDetail(e: Event) {
    const el = e.target as HTMLElement | null
    if (el?.closest('[data-policy-card-stop]')) return
    onSettingsNavigate?.({ type: 'brain-access-policy', policyId: model.policyId })
  }
</script>

{#if variant === 'select'}
  <label
    class={cn(
      'policy-card policy-card--select flex cursor-pointer gap-3 rounded-lg border border-l-4 p-3 text-left transition-colors',
      tone.bar,
      selected ? [tone.ring, tone.softBg] : ['border-border', 'bg-surface'],
      disabled && 'cursor-not-allowed opacity-50',
    )}
  >
    <input
      type="radio"
      class="mt-0.5 shrink-0"
      name={radioName}
      value={model.policyId}
      checked={selected}
      {disabled}
      onchange={() => onSelect?.(model.policyId)}
    />
    <span class="min-w-0 flex-1 flex flex-col gap-0.5">
      <span class="m-0 text-[0.875rem] font-bold uppercase tracking-[0.04em] leading-tight text-foreground">
        {model.label}
      </span>
      {#if model.hint}
        <span class="m-0 block max-w-[42rem] text-[0.8125rem] leading-tight text-muted">{model.hint}</span>
      {/if}
    </span>
  </label>
{:else}
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
    onclick={openPolicyDetail}
    onkeydown={(e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const el = e.target as HTMLElement | null
      if (el?.closest('[data-policy-card-stop]')) return
      e.preventDefault()
      onSettingsNavigate?.({ type: 'brain-access-policy', policyId: model.policyId })
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
          onPick={(entry) => void onAddUser?.(model, entry)}
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5" data-policy-card-stop>
      {#each model.grants as grant (grant.id)}
        <UserBubble
          grantId={grant.id}
          handle={grant.askerHandle ?? grant.askerId}
          policyIdForDetail={model.policyId}
          onSettingsNavigate={onSettingsNavigate!}
          onChangePolicy={() => onOpenChangePolicy?.(grant.id)}
          onRemove={() => void onRemoveGrant?.(grant.id)}
          removeBusy={removeBusyId === grant.id}
        />
      {/each}
    </div>
  </div>
{/if}
