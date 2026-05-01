<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte'

  let {
    open,
    pathPrefix,
    targetKind,
    onDismiss,
  }: {
    open: boolean
    /** Vault-relative path: directory prefix ending with `/`, or a single `.md` path for files */
    pathPrefix: string
    targetKind: 'dir' | 'file'
    onDismiss: () => void
  } = $props()

  let granteeEmail = $state('')
  let submitting = $state(false)
  let errorMsg = $state('')
  let inviteUrl = $state('')
  let emailSent = $state(false)

  const dialogTitle = $derived(targetKind === 'file' ? 'Share wiki page' : 'Share wiki folder')

  $effect(() => {
    if (open) {
      granteeEmail = ''
      submitting = false
      errorMsg = ''
      inviteUrl = ''
      emailSent = false
    }
  })

  async function submit() {
    errorMsg = ''
    inviteUrl = ''
    submitting = true
    try {
      const res = await fetch('/api/wiki-shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pathPrefix,
          granteeEmail: granteeEmail.trim(),
          targetKind,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as {
        error?: string
        inviteUrl?: string
        emailSent?: boolean
      }
      if (!res.ok) {
        errorMsg = j.error ?? 'Request failed'
        return
      }
      if (typeof j.inviteUrl === 'string') inviteUrl = j.inviteUrl
      emailSent = Boolean(j.emailSent)
    } catch {
      errorMsg = 'Network error'
    } finally {
      submitting = false
    }
  }
</script>

<ConfirmDialog
  {open}
  title={dialogTitle}
  confirmLabel="OK"
  cancelLabel="Cancel"
  onDismiss={() => {
    onDismiss()
  }}
  onConfirm={() => {}}
>
  {#snippet actions()}
    <button type="button" class="wsh-btn" onclick={() => onDismiss()}>Cancel</button>
    {#if inviteUrl}
      <button type="button" class="wsh-btn wsh-btn-primary" onclick={() => onDismiss()}>Done</button>
    {:else}
      <button
        type="button"
        class="wsh-btn wsh-btn-primary"
        disabled={submitting || !granteeEmail.trim()}
        onclick={() => void submit()}
      >
        {submitting ? 'Creating…' : 'Create invite'}
      </button>
    {/if}
  {/snippet}
  {#snippet children()}
    <p class="wsh-lead">
      Read-only access to <code class="wsh-code">{pathPrefix}</code>
    </p>
    {#if inviteUrl}
      <p class="wsh-hint">
        {emailSent ? 'Invite email sent. You can also copy the link below.' : 'Copy this link and send it to your collaborator:'}
      </p>
      <label class="wsh-label" for="wsh-invite-url">Invite link</label>
      <textarea id="wsh-invite-url" class="wsh-textarea" readonly rows={3}>{inviteUrl}</textarea>
    {:else}
      <label class="wsh-label" for="wsh-email">Grantee email</label>
      <input
        id="wsh-email"
        class="wsh-input"
        type="email"
        autocomplete="email"
        placeholder="name@example.com"
        bind:value={granteeEmail}
        disabled={submitting}
      />
      {#if errorMsg}
        <p class="wsh-err" role="alert">{errorMsg}</p>
      {/if}
    {/if}
  {/snippet}
</ConfirmDialog>

<style>
  .wsh-lead {
    margin: 0 0 12px;
    font-size: 14px;
    color: var(--color-muted, #888);
  }
  .wsh-code {
    font-size: 13px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--color-surface-2, rgba(0, 0, 0, 0.06));
  }
  .wsh-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .wsh-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    font-size: 14px;
    border-radius: 6px;
    border: 1px solid var(--color-border, #ccc);
  }
  .wsh-textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    font-size: 13px;
    border-radius: 6px;
    border: 1px solid var(--color-border, #ccc);
    font-family: ui-monospace, monospace;
  }
  .wsh-hint {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .wsh-err {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--color-danger, #b42318);
  }
  :global(.cd-actions) .wsh-btn {
    padding: 8px 14px;
    font-size: 14px;
    border-radius: 6px;
    border: 1px solid var(--color-border, #ccc);
    background: var(--color-surface, #fff);
    cursor: pointer;
  }
  :global(.cd-actions) .wsh-btn-primary {
    background: var(--color-accent, #2563eb);
    color: #fff;
    border-color: transparent;
  }
  :global(.cd-actions) .wsh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
