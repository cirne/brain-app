<script lang="ts">
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import { BRAIN_QUERY_POLICY_TEMPLATES } from '@client/lib/brainQueryPolicyTemplates.js'
  import type { BrainAccessCustomPolicy } from '@client/lib/brainAccessCustomPolicies.js'

  type Target = { policyId: string; label: string; text: string }

  type Props = {
    open: boolean
    grantId: string | null
    customPolicies: BrainAccessCustomPolicy[]
    excludePolicyId?: string
    onDismiss: () => void
    onApply: (_grantId: string, _newPrivacyPolicyText: string) => void | Promise<void>
  }

  let { open, grantId, customPolicies, excludePolicyId, onDismiss, onApply }: Props = $props()

  let selectedPolicyId = $state('')
  let busy = $state(false)

  const targets = $derived.by((): Target[] => {
    const builtin: Target[] = BRAIN_QUERY_POLICY_TEMPLATES.map((t) => ({
      policyId: t.id,
      label: t.label,
      text: t.text,
    }))
    const custom: Target[] = customPolicies.map((c) => ({
      policyId: c.id,
      label: c.name,
      text: c.text,
    }))
    return [...builtin, ...custom].filter((t) => t.policyId !== excludePolicyId)
  })

  $effect(() => {
    if (open && targets[0]) selectedPolicyId = targets[0].policyId
    else if (open) selectedPolicyId = ''
  })

  async function confirm(): Promise<void> {
    if (targets.length === 0) return
    const gid = grantId
    const row = targets.find((t) => t.policyId === selectedPolicyId)
    const text = row?.text.trim() ?? ''
    if (!gid || !text || busy) return
    busy = true
    try {
      await onApply(gid, text)
      onDismiss()
    } finally {
      busy = false
    }
  }
</script>

<ConfirmDialog
  {open}
  title="Move to another policy"
  titleId="brain-change-policy-title"
  confirmLabel={busy ? 'Applying…' : 'Apply'}
  cancelLabel="Cancel"
  panelClass="max-w-[24rem]"
  onDismiss={() => {
    if (!busy) onDismiss()
  }}
  onConfirm={() => void confirm()}
>
  <p class="text-[0.8125rem] text-muted">Pick which privacy preset this collaborator should use.</p>
  {#if targets.length === 0}
    <p class="text-[0.8125rem] text-danger">No other policies available.</p>
  {:else}
    <div class="mt-2 flex flex-col gap-2">
      {#each targets as t (t.policyId)}
        <label class="flex cursor-pointer gap-2 text-[0.8125rem]">
          <input
            type="radio"
            bind:group={selectedPolicyId}
            value={t.policyId}
            name="brain-move-policy"
            class="mt-1 accent-accent"
          />
          <span><strong>{t.label}</strong></span>
        </label>
      {/each}
    </div>
  {/if}
</ConfirmDialog>
