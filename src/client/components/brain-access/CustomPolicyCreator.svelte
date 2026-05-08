<script lang="ts">
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import { BRAIN_QUERY_POLICY_TEMPLATES } from '@client/lib/brainQueryPolicyTemplates.js'
  import { addBrainAccessCustomPolicy } from '@client/lib/brainAccessCustomPolicies.js'

  type Props = {
    open: boolean
    onDismiss: () => void
    /** Called after policy saved to localStorage */
    onCreated: () => void
  }

  let { open, onDismiss, onCreated }: Props = $props()

  let name = $state('')
  let body = $state('')
  let templateKey = $state<'none' | string>('none')
  let colorChoice = $state('0')
  let busy = $state(false)

  $effect(() => {
    if (open) {
      name = ''
      body = ''
      templateKey = 'none'
      colorChoice = '0'
    }
  })

  $effect(() => {
    if (!open) return
    if (templateKey === 'none') return
    const t = BRAIN_QUERY_POLICY_TEMPLATES.find((x) => x.id === templateKey)
    if (t) body = t.text
  })

  async function confirm(): Promise<void> {
    const n = name.trim()
    const text = body.trim()
    if (!n || !text || busy) return
    busy = true
    try {
      addBrainAccessCustomPolicy({
        name: n,
        text,
        colorIndex: Number.parseInt(colorChoice, 10) || 0,
      })
      onCreated()
      onDismiss()
    } finally {
      busy = false
    }
  }
</script>

<ConfirmDialog
  {open}
  title="Create custom policy"
  titleId="brain-custom-policy-title"
  confirmLabel={busy ? 'Saving…' : 'Save policy'}
  cancelLabel="Cancel"
  panelClass="max-w-[36rem]"
  onDismiss={() => {
    if (!busy) onDismiss()
  }}
  onConfirm={() => void confirm()}
>
  <div class="flex flex-col gap-3 text-[0.8125rem]">
    <label class="flex flex-col gap-1">
      <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">Policy name</span>
      <input
        type="text"
        class="rounded border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface px-2 py-1.5 text-foreground"
        bind:value={name}
        disabled={busy}
        placeholder="e.g. Executive team"
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">Start from template</span>
      <select
        class="rounded border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface px-2 py-1.5 text-foreground"
        bind:value={templateKey}
        disabled={busy}
      >
        <option value="none">Blank</option>
        {#each BRAIN_QUERY_POLICY_TEMPLATES as tpl (tpl.id)}
          <option value={tpl.id}>{tpl.label}</option>
        {/each}
      </select>
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">Color accent</span>
      <select
        class="rounded border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface px-2 py-1.5 text-foreground"
        bind:value={colorChoice}
        disabled={busy}
      >
        <option value="0">Amber</option>
        <option value="1">Orange</option>
        <option value="2">Pink</option>
        <option value="3">Teal</option>
        <option value="4">Indigo</option>
      </select>
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">Privacy guidance</span>
      <textarea
        class="min-h-[10rem] rounded border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface p-2 text-[0.8125rem] leading-snug text-foreground"
        bind:value={body}
        disabled={busy}
      ></textarea>
    </label>
  </div>
</ConfirmDialog>
