<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte'
  import { tick } from 'svelte'

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

  type DirectoryEntry = {
    userId: string
    handle: string
    displayName?: string
    primaryEmail: string | null
  }

  type SelectedGrantee = {
    /** Stable key for the chip list. */
    key: string
    /** When known, the @-handle (preferred for POST). */
    handle?: string
    /** Resolved email (always present for handle picks; equals raw input for typed emails). */
    email: string
    /** Full name from Google profile, when known. */
    displayName?: string
  }

  type CreatedInvite = {
    grantee: SelectedGrantee
    inviteUrl: string
    emailSent: boolean
  }

  let inputValue = $state('')
  let selected = $state<SelectedGrantee[]>([])
  let suggestions = $state<DirectoryEntry[]>([])
  let suggestIndex = $state(0)
  let suggestOpen = $state(false)
  let suggestLoading = $state(false)

  let submitting = $state(false)
  let errorMsg = $state('')
  let perGranteeErrors = $state<Record<string, string>>({})
  let createdInvites = $state<CreatedInvite[]>([])

  let inputEl: HTMLInputElement | undefined = $state()
  let searchToken = 0

  const dialogTitle = $derived(targetKind === 'file' ? 'Share wiki page' : 'Share wiki folder')

  $effect(() => {
    if (open) {
      inputValue = ''
      selected = []
      suggestions = []
      suggestIndex = 0
      suggestOpen = false
      suggestLoading = false
      submitting = false
      errorMsg = ''
      perGranteeErrors = {}
      createdInvites = []
    }
  })

  function looksLikeEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  }

  /** Strip a single leading `@`, lowercase, and trim. */
  function normalizeHandleInput(raw: string): string {
    return raw.trim().replace(/^@/, '').toLowerCase()
  }

  function chipKey(g: SelectedGrantee): string {
    return g.handle ? `@${g.handle.toLowerCase()}` : g.email.toLowerCase()
  }

  function isAlreadySelected(g: { handle?: string; email?: string }): boolean {
    const key = g.handle
      ? `@${g.handle.toLowerCase()}`
      : (g.email ?? '').toLowerCase()
    if (!key) return false
    return selected.some((s) => chipKey(s) === key)
  }

  async function loadSuggestions(query: string): Promise<void> {
    const myToken = ++searchToken
    suggestLoading = true
    try {
      const url = `/api/account/workspace-handles?q=${encodeURIComponent(query)}`
      const res = await fetch(url)
      if (!res.ok) {
        if (myToken === searchToken) suggestions = []
        return
      }
      const j = (await res.json().catch(() => ({}))) as { results?: DirectoryEntry[] }
      if (myToken !== searchToken) return
      suggestions = Array.isArray(j.results) ? j.results : []
      suggestIndex = 0
    } catch {
      if (myToken === searchToken) suggestions = []
    } finally {
      if (myToken === searchToken) suggestLoading = false
    }
  }

  function onInput(e: Event): void {
    const target = e.target as HTMLInputElement
    inputValue = target.value
    const trimmed = inputValue.trim()

    if (trimmed.length === 0 || looksLikeEmail(trimmed)) {
      suggestOpen = false
      suggestions = []
      return
    }

    suggestOpen = true
    void loadSuggestions(normalizeHandleInput(inputValue))
  }

  function commitTyped(): void {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    if (looksLikeEmail(trimmed)) {
      const email = trimmed.toLowerCase()
      if (!isAlreadySelected({ email })) {
        selected = [...selected, { key: email, email }]
      }
      inputValue = ''
      suggestOpen = false
      return
    }
    const handle = normalizeHandleInput(trimmed)
    if (!handle) return
    const match = suggestions.find((s) => s.handle.toLowerCase() === handle)
    if (match) {
      selectFromDirectory(match)
      return
    }
    perGranteeErrors = {
      ...perGranteeErrors,
      [`@${handle}`]: 'Pick a user from the list.',
    }
  }

  function selectFromDirectory(entry: DirectoryEntry): void {
    if (isAlreadySelected({ handle: entry.handle })) {
      inputValue = ''
      suggestOpen = false
      return
    }
    const grantee: SelectedGrantee = {
      key: `@${entry.handle.toLowerCase()}`,
      handle: entry.handle,
      email: entry.primaryEmail ?? '',
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
    }
    selected = [...selected, grantee]
    inputValue = ''
    suggestOpen = false
    void tick().then(() => inputEl?.focus())
  }

  function removeChip(key: string): void {
    selected = selected.filter((g) => g.key !== key)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (suggestOpen && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        suggestIndex = Math.min(suggestIndex + 1, suggestions.length - 1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        suggestIndex = Math.max(suggestIndex - 1, 0)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const item = suggestions[suggestIndex]
        if (item) {
          e.preventDefault()
          selectFromDirectory(item)
          return
        }
      }
      if (e.key === 'Escape') {
        suggestOpen = false
        return
      }
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      const trimmed = inputValue.trim()
      if (trimmed.length > 0 && (e.key === 'Enter' || e.key === ',')) {
        e.preventDefault()
        commitTyped()
      } else if (e.key === ' ' && trimmed.length > 0 && (looksLikeEmail(trimmed) || normalizeHandleInput(trimmed).length > 0)) {
        e.preventDefault()
        commitTyped()
      }
      return
    }
    if (e.key === 'Backspace' && inputValue.length === 0 && selected.length > 0) {
      e.preventDefault()
      removeChip(selected[selected.length - 1]!.key)
    }
  }

  function onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text') ?? ''
    if (!text || !/[\s,]/.test(text)) return
    e.preventDefault()
    const tokens = text.split(/[\s,]+/).filter(Boolean)
    for (const tok of tokens) {
      inputValue = tok
      commitTyped()
    }
    inputValue = ''
  }

  async function submit(): Promise<void> {
    errorMsg = ''
    perGranteeErrors = {}
    createdInvites = []
    if (selected.length === 0) {
      const trimmed = inputValue.trim()
      if (trimmed) commitTyped()
      if (selected.length === 0) {
        errorMsg = 'Add at least one collaborator.'
        return
      }
    }
    submitting = true
    const successes: CreatedInvite[] = []
    const errors: Record<string, string> = {}
    try {
      for (const g of selected) {
        const body: Record<string, string> = { pathPrefix, targetKind }
        if (g.handle) body.granteeHandle = g.handle
        else body.granteeEmail = g.email
        try {
          const res = await fetch('/api/wiki-shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          const j = (await res.json().catch(() => ({}))) as {
            error?: string
            message?: string
            inviteUrl?: string
            emailSent?: boolean
          }
          if (!res.ok || typeof j.inviteUrl !== 'string') {
            errors[g.key] = j.message ?? j.error ?? 'Request failed'
            continue
          }
          successes.push({
            grantee: g,
            inviteUrl: j.inviteUrl,
            emailSent: Boolean(j.emailSent),
          })
        } catch {
          errors[g.key] = 'Network error'
        }
      }
      createdInvites = successes
      perGranteeErrors = errors
    } finally {
      submitting = false
    }
  }

  const submitDisabled = $derived(
    submitting ||
      (selected.length === 0 && inputValue.trim().length === 0) ||
      selected.some((g) => !g.email),
  )

  function tooltipFor(g: SelectedGrantee): string {
    const lines: string[] = []
    if (g.displayName) lines.push(g.displayName)
    if (g.handle) lines.push(`@${g.handle}`)
    if (g.email) lines.push(g.email)
    return lines.join('\n')
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
    <button type="button" class="wsh-btn" onclick={() => onDismiss()}>
      {createdInvites.length > 0 ? 'Done' : 'Cancel'}
    </button>
    {#if createdInvites.length === 0}
      <button
        type="button"
        class="wsh-btn wsh-btn-primary"
        disabled={submitDisabled}
        onclick={() => void submit()}
      >
        {submitting ? 'Creating…' : selected.length > 1 ? 'Create invites' : 'Create invite'}
      </button>
    {/if}
  {/snippet}
  <p class="wsh-lead">
    Read-only access to <code class="wsh-code">{pathPrefix}</code>
  </p>
    {#if createdInvites.length > 0}
      <ul class="wsh-invite-list">
        {#each createdInvites as inv (inv.grantee.key)}
          <li class="wsh-invite">
            <div class="wsh-invite-head">
              <span class="wsh-invite-target">
                {inv.grantee.handle ? `@${inv.grantee.handle}` : inv.grantee.email}
              </span>
              {#if inv.emailSent}
                <span class="wsh-pill">Email sent</span>
              {:else}
                <span class="wsh-pill wsh-pill-muted">Copy link</span>
              {/if}
            </div>
            <textarea class="wsh-textarea" readonly rows={2} aria-label={`Invite link for ${inv.grantee.handle ?? inv.grantee.email}`}>{inv.inviteUrl}</textarea>
          </li>
        {/each}
      </ul>
      {#if Object.keys(perGranteeErrors).length > 0}
        <p class="wsh-hint">Some invites could not be created:</p>
        <ul class="wsh-err-list">
          {#each Object.entries(perGranteeErrors) as [key, msg] (key)}
            <li class="wsh-err">{key}: {msg}</li>
          {/each}
        </ul>
      {/if}
    {:else}
      <label class="wsh-label" for="wsh-grantees">Add collaborators by handle (e.g. <code>@cirne</code>) or email</label>
      <div class="wsh-field">
        <div class="wsh-chips">
          {#each selected as g (g.key)}
            <span
              class="wsh-chip"
              class:wsh-chip-warn={!g.email}
              title={tooltipFor(g)}
            >
              <span class="wsh-chip-label">
                {g.handle ? `@${g.handle}` : g.email}
              </span>
              {#if g.displayName || g.email}
                <span class="wsh-chip-meta">
                  {g.displayName ?? ''}{g.displayName && g.email ? ' · ' : ''}{g.email ?? ''}
                </span>
              {/if}
              <button
                type="button"
                class="wsh-chip-x"
                aria-label={`Remove ${g.handle ? '@' + g.handle : g.email}`}
                onclick={() => removeChip(g.key)}
              >×</button>
            </span>
          {/each}
          <input
            id="wsh-grantees"
            class="wsh-chip-input"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder={selected.length === 0 ? '@handle or name@example.com' : ''}
            bind:this={inputEl}
            bind:value={inputValue}
            oninput={onInput}
            onkeydown={onKeydown}
            onpaste={onPaste}
            disabled={submitting}
          />
        </div>
        {#if suggestOpen && (suggestions.length > 0 || suggestLoading)}
          <div class="wsh-suggest" role="listbox">
            {#if suggestLoading && suggestions.length === 0}
              <div class="wsh-suggest-empty">Searching…</div>
            {/if}
            {#each suggestions as s, i (s.userId)}
              <button
                type="button"
                role="option"
                aria-selected={i === suggestIndex}
                class="wsh-suggest-item"
                class:selected={i === suggestIndex}
                onmousedown={(e) => {
                  e.preventDefault()
                  selectFromDirectory(s)
                }}
              >
                <span class="wsh-suggest-handle">@{s.handle}</span>
                {#if s.displayName}
                  <span class="wsh-suggest-name">{s.displayName}</span>
                {/if}
                <span class="wsh-suggest-email">
                  {s.primaryEmail ?? 'No connected email'}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if selected.some((g) => !g.email)}
        <p class="wsh-hint wsh-hint-warn">
          Selected users without a connected email cannot receive invites yet.
        </p>
      {/if}
      {#if Object.keys(perGranteeErrors).length > 0}
        <ul class="wsh-err-list">
          {#each Object.entries(perGranteeErrors) as [key, msg] (key)}
            <li class="wsh-err">{key}: {msg}</li>
          {/each}
        </ul>
      {/if}
      {#if errorMsg}
        <p class="wsh-err" role="alert">{errorMsg}</p>
      {/if}
    {/if}
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
  .wsh-field {
    position: relative;
  }
  .wsh-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid var(--color-border, #ccc);
    background: var(--bg, #fff);
    min-height: 38px;
  }
  .wsh-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    max-width: 100%;
    padding: 3px 6px 3px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent, #2563eb) 12%, transparent);
    color: var(--text, inherit);
    font-size: 12px;
    line-height: 1.3;
  }
  .wsh-chip-warn {
    background: color-mix(in srgb, var(--danger, #b42318) 14%, transparent);
  }
  .wsh-chip-label {
    font-weight: 600;
  }
  .wsh-chip-meta {
    color: var(--text-2, #666);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }
  .wsh-chip-x {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
  }
  .wsh-chip-input {
    flex: 1;
    min-width: 140px;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 13px;
    padding: 4px 2px;
  }
  .wsh-suggest {
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    margin-top: 4px;
    z-index: 10;
    max-height: 220px;
    overflow-y: auto;
    background: var(--bg-3, #fff);
    border: 1px solid var(--color-border, #ccc);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .wsh-suggest-item {
    display: grid;
    grid-template-columns: auto 1fr auto;
    column-gap: 8px;
    align-items: baseline;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    padding: 6px 10px;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .wsh-suggest-item.selected,
  .wsh-suggest-item:hover {
    background: var(--accent-dim, rgba(37, 99, 235, 0.12));
  }
  .wsh-suggest-handle {
    font-weight: 600;
    font-size: 13px;
  }
  .wsh-suggest-name {
    font-size: 13px;
    color: var(--text, inherit);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wsh-suggest-email {
    font-size: 12px;
    color: var(--text-2, #666);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wsh-suggest-empty {
    padding: 8px 10px;
    font-size: 12px;
    color: var(--text-2, #666);
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
    margin: 8px 0 0;
    font-size: 13px;
  }
  .wsh-hint-warn {
    color: var(--danger, #b42318);
  }
  .wsh-err {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--danger, #b42318);
  }
  .wsh-err-list {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
  }
  .wsh-err-list .wsh-err {
    margin: 4px 0 0;
  }
  .wsh-invite-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .wsh-invite-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }
  .wsh-invite-target {
    font-weight: 600;
    font-size: 13px;
  }
  .wsh-pill {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent, #2563eb) 18%, transparent);
    color: var(--accent, #2563eb);
  }
  .wsh-pill-muted {
    background: var(--color-surface-2, rgba(0, 0, 0, 0.08));
    color: var(--text-2, #666);
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
