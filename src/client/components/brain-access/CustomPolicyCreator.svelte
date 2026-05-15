<script lang="ts">
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import { t } from '@client/lib/i18n/index.js'
  import type { BrainQueryPolicyTemplate } from '@client/lib/brainQueryPolicyTemplates.js'

  type Props = {
    open: boolean
    grantPolicyTemplates: BrainQueryPolicyTemplate[]
    onDismiss: () => void
    /** Called after policy is saved on the server. */
    onCreated: () => void
  }

  let { open, grantPolicyTemplates, onDismiss, onCreated }: Props = $props()

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
    const template = grantPolicyTemplates.find((x) => x.id === templateKey)
    if (template) body = template.text
  })

  async function confirm(): Promise<void> {
    const n = name.trim()
    const text = body.trim()
    if (!n || !text || busy) return
    busy = true
    try {
      const res = await fetch('/api/brain-query/policies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: n, body: text }),
      })
      if (!res.ok) return
      onCreated()
      onDismiss()
    } finally {
      busy = false
    }
  }
</script>

<ConfirmDialog
  {open}
  title={$t('access.customPolicyCreator.title')}
  titleId="brain-custom-policy-title"
  confirmLabel={busy ? $t('common.status.saving') : $t('access.customPolicyCreator.actions.savePolicy')}
  cancelLabel={$t('common.actions.cancel')}
  panelClass="max-w-[36rem]"
  onDismiss={() => {
    if (!busy) onDismiss()
  }}
  onConfirm={() => void confirm()}
>
  <div class="flex flex-col gap-3 text-[0.8125rem]">
    <label class="flex flex-col gap-1">
      <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">
        {$t('access.customPolicyCreator.fields.policyName.label')}
      </span>
      <input
        type="text"
        class="rounded border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface px-2 py-1.5 text-foreground"
        bind:value={name}
        disabled={busy}
        placeholder={$t('access.customPolicyCreator.fields.policyName.placeholder')}
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">
        {$t('access.customPolicyCreator.fields.startFromTemplate')}
      </span>
      <select
        class="rounded border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface px-2 py-1.5 text-foreground"
        bind:value={templateKey}
        disabled={busy}
      >
        <option value="none">{$t('access.customPolicyCreator.templateOptions.blank')}</option>
        {#each grantPolicyTemplates as tpl (tpl.id)}
          <option value={tpl.id}>{$t(tpl.labelKey)}</option>
        {/each}
      </select>
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">
        {$t('access.customPolicyCreator.fields.colorAccent')}
      </span>
      <select
        class="rounded border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface px-2 py-1.5 text-foreground"
        bind:value={colorChoice}
        disabled={busy}
      >
        <option value="0">{$t('access.customPolicyCreator.colorOptions.amber')}</option>
        <option value="1">{$t('access.customPolicyCreator.colorOptions.orange')}</option>
        <option value="2">{$t('access.customPolicyCreator.colorOptions.pink')}</option>
        <option value="3">{$t('access.customPolicyCreator.colorOptions.teal')}</option>
        <option value="4">{$t('access.customPolicyCreator.colorOptions.indigo')}</option>
      </select>
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">
        {$t('access.customPolicyCreator.fields.privacyGuidance')}
      </span>
      <textarea
        class="min-h-[10rem] rounded border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface p-2 text-[0.8125rem] leading-snug text-foreground"
        bind:value={body}
        disabled={busy}
      ></textarea>
    </label>
  </div>
</ConfirmDialog>
