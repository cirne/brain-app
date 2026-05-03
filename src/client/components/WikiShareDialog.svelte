<script lang="ts">
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import WikiFileName from '@components/WikiFileName.svelte'
  import { cn } from '@client/lib/cn.js'
  import { wikiShareCoversVaultPath } from '@client/lib/wikiDirListModel.js'
  import { wikiShareVaultPathForWikiFileName } from '@client/lib/wikiPathDisplay.js'
  import { emit } from '@client/lib/app/appEvents.js'
  import { tick } from 'svelte'

  let {
    open,
    pathPrefix,
    targetKind,
    onDismiss,
    onSharesChanged,
  }: {
    open: boolean
    /** Vault-relative path: directory prefix ending with `/`, or a single `.md` path for files */
    pathPrefix: string
    targetKind: 'dir' | 'file'
    onDismiss: () => void
    /** Refresh wiki list hints / badges after share mutations */
    onSharesChanged?: () => void
  } = $props()

  /** Mirrors server wikiSharesRepo.WIKI_SHARE_INVITE_TTL_MS — keep in sync manually. */
  const WIKI_SHARE_INVITE_TTL_MS = 604_800_000

  type WikiAudienceRow = {
    id: string
    granteeEmail: string
    granteeId: string | null
    pathPrefix: string
    targetKind: 'dir' | 'file'
    acceptedAtMs: number | null
    createdAtMs: number
  }

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

  let inputValue = $state('')
  let selected = $state<SelectedGrantee[]>([])
  let suggestions = $state<DirectoryEntry[]>([])
  let suggestIndex = $state(0)
  let suggestOpen = $state(false)
  let suggestLoading = $state(false)

  let submitting = $state(false)
  let errorMsg = $state('')
  let perGranteeErrors = $state<Record<string, string>>({})

  let inputEl: HTMLInputElement | undefined = $state()
  let searchToken = 0

  let audienceRows = $state<WikiAudienceRow[]>([])
  let audienceLoading = $state(false)
  let audienceFetchError = $state('')
  let revokeTarget = $state<WikiAudienceRow | null>(null)
  let revokingId = $state<string | null>(null)
  let audienceFetchToken = 0

  const dialogTitle = $derived(targetKind === 'file' ? 'Share this page' : 'Share this folder')

  const shareActionLabel = 'Send invites'

  const wikiShareDisplayPathForFileName = $derived(
    wikiShareVaultPathForWikiFileName({ pathPrefix, targetKind }),
  )

  $effect(() => {
    if (!open) {
      audienceFetchToken += 1
      audienceRows = []
      audienceFetchError = ''
      revokeTarget = null
      revokingId = null
      return
    }
    inputValue = ''
    selected = []
    suggestions = []
    suggestIndex = 0
    suggestOpen = false
    suggestLoading = false
    submitting = false
    errorMsg = ''
    perGranteeErrors = {}
    void pathPrefix
    void targetKind
    void reloadAudienceShares()
  })

  function dialogResourceVaultPath(): string {
    let p = pathPrefix.trim().replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+/g, '/')
    if (targetKind === 'dir') p = p.replace(/\/+$/, '')
    return p
  }

  function parseAudienceRow(x: unknown): WikiAudienceRow | null {
    if (!x || typeof x !== 'object') return null
    const o = x as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.granteeEmail !== 'string' || typeof o.pathPrefix !== 'string') {
      return null
    }
    const cre = o.createdAtMs
    const acc = o.acceptedAtMs
    if (typeof cre !== 'number') return null
    const tk = o.targetKind === 'file' ? ('file' as const) : ('dir' as const)
    return {
      id: o.id,
      granteeEmail: o.granteeEmail,
      granteeId: typeof o.granteeId === 'string' && o.granteeId ? o.granteeId : null,
      pathPrefix: o.pathPrefix,
      targetKind: tk,
      acceptedAtMs: typeof acc === 'number' ? acc : null,
      createdAtMs: cre,
    }
  }

  async function reloadAudienceShares(): Promise<void> {
    const t = ++audienceFetchToken
    audienceLoading = true
    audienceFetchError = ''
    try {
      const res = await fetch('/api/wiki-shares')
      const j = (await res.json().catch(() => ({}))) as { owned?: unknown }
      if (t !== audienceFetchToken) return
      if (!res.ok) {
        audienceFetchError = 'Couldn’t load this list.'
        audienceRows = []
        return
      }
      const raw = Array.isArray(j.owned) ? j.owned : []
      const vp = dialogResourceVaultPath()
      const parsed = raw.map(parseAudienceRow).filter((r): r is WikiAudienceRow => r !== null)
      audienceRows = parsed.filter((r) => wikiShareCoversVaultPath(vp, r.pathPrefix, r.targetKind))
    } catch {
      if (t !== audienceFetchToken) return
      audienceFetchError = 'Couldn’t load this list.'
      audienceRows = []
    } finally {
      if (t === audienceFetchToken) audienceLoading = false
    }
  }

  type AudienceStatus = 'active' | 'pending' | 'expired'

  function audienceStatus(row: WikiAudienceRow): AudienceStatus {
    if (row.acceptedAtMs != null) return 'active'
    if (Date.now() - row.createdAtMs > WIKI_SHARE_INVITE_TTL_MS) return 'expired'
    return 'pending'
  }

  async function runRevokeAccess(): Promise<void> {
    const row = revokeTarget
    if (!row) return
    revokingId = row.id
    audienceFetchError = ''
    try {
      const res = await fetch(`/api/wiki-shares/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        audienceFetchError = 'Couldn’t remove access.'
        return
      }
      revokeTarget = null
      await reloadAudienceShares()
      onSharesChanged?.()
      emit({ type: 'wiki-shares-changed' })
    } finally {
      revokingId = null
    }
  }

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
      [`@${handle}`]: 'Choose someone from the list.',
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
    if (selected.length === 0) {
      const trimmed = inputValue.trim()
      if (trimmed) commitTyped()
      if (selected.length === 0) {
        errorMsg = 'Add someone to invite.'
        return
      }
    }
    submitting = true
    const errors: Record<string, string> = {}
    let anySuccess = false
    try {
      for (const g of selected) {
        const body: Record<string, unknown> = { pathPrefix, targetKind }
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
            id?: string
          }
          if (!res.ok || typeof j.id !== 'string') {
            errors[g.key] = j.message ?? j.error ?? 'Request failed'
            continue
          }
          anySuccess = true
        } catch {
          errors[g.key] = 'Network error'
        }
      }
      perGranteeErrors = errors
      if (anySuccess) {
        selected = []
        inputValue = ''
        suggestOpen = false
        await reloadAudienceShares()
        onSharesChanged?.()
        emit({ type: 'wiki-shares-changed' })
      }
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

  const sectionTitle = 'wsh-section-title m-0 mb-2 text-[13px] font-semibold text-foreground'
  const mutedText = 'wsh-muted m-0 text-[13px] text-muted'
  const errBase = 'wsh-err m-0 mt-2 text-[13px] text-[var(--danger,#b42318)]'
  const pillBase =
    'wsh-pill rounded-full bg-[color-mix(in_srgb,var(--accent,#2563eb)_18%,transparent)] px-1.5 py-[2px] text-[11px] text-[var(--accent,#2563eb)]'
  const sharePathName =
    'wsh-share-path-name inline-flex max-w-full align-text-bottom text-foreground'
  const codeChip =
    'wsh-code bg-[var(--color-surface-2,rgba(0,0,0,0.06))] px-1.5 py-px text-[13px]'
</script>

<ConfirmDialog
  {open}
  titleId="wiki-share-main-title"
  panelClass="wiki-share-cd-panel w-[90vw] max-w-[600px]"
  title={dialogTitle}
  confirmLabel="OK"
  cancelLabel="Cancel"
  onDismiss={() => {
    onDismiss()
  }}
  onConfirm={() => {}}
>
  {#snippet actions()}
    <button type="button" class="cd-btn" onclick={() => onDismiss()}>Cancel</button>
    <button
      type="button"
      class="cd-btn cd-btn--primary"
      disabled={submitDisabled}
      onclick={() => void submit()}
    >
      {submitting ? 'Sending…' : shareActionLabel}
    </button>
  {/snippet}
  <p class="wsh-lead m-0 mb-3 text-sm text-[var(--color-muted,#888)]">
    People you invite see this read-only; they can’t edit it.
  </p>
  <section class="wsh-section mb-[18px]" aria-labelledby="wsh-audience-heading">
    <h3 id="wsh-audience-heading" class={sectionTitle}>Who has access</h3>
    {#if audienceLoading}
      <p class={mutedText}>Loading…</p>
    {:else if audienceFetchError}
      <p class={errBase} role="alert">{audienceFetchError}</p>
    {:else if audienceRows.length === 0}
      <p class={mutedText}>Just you so far.</p>
    {:else}
      <ul
        class="wsh-audience-list m-0 flex max-h-[220px] list-none flex-col gap-2 overflow-y-auto p-0"
      >
        {#each audienceRows as row (row.id)}
          <li
            class="wsh-audience-row flex items-center justify-between gap-2.5 border border-[var(--color-border,#ccc)] bg-[var(--bg,#fff)] px-2.5 py-2"
          >
            <div class="wsh-audience-main flex min-w-0 flex-col items-start gap-1">
              <span class="wsh-audience-email text-[13px] font-semibold [word-break:break-all]"
                >{row.granteeEmail}</span
              >
              {#if audienceStatus(row) === 'active'}
                <span class={pillBase}>Has access</span>
              {:else if audienceStatus(row) === 'expired'}
                <span
                  class="wsh-pill wsh-pill-warn rounded-full bg-[color-mix(in_srgb,var(--danger,#c44)_16%,transparent)] px-1.5 py-[2px] text-[11px] text-[var(--danger,#c44)]"
                >Invite expired</span>
              {:else}
                <span
                  class="wsh-pill wsh-pill-pending rounded-full bg-[color-mix(in_srgb,var(--accent,#2563eb)_14%,transparent)] px-1.5 py-[2px] text-[11px] text-[var(--accent,#2563eb)]"
                >Invite sent</span>
              {/if}
            </div>
            <button
              type="button"
              class="cd-btn wsh-remove-btn shrink-0 !text-xs"
              disabled={revokingId === row.id}
              onclick={() => {
                revokeTarget = row
              }}
            >
              {revokingId === row.id ? 'Removing…' : 'Remove'}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <h3 class="{sectionTitle} wsh-invite-heading mt-1">Invite someone</h3>
  <label class="wsh-label mb-1.5 block text-xs font-semibold" for="wsh-grantees">
    @username or email (e.g. <code class={codeChip}>@alex</code>)
  </label>
  <div class="wsh-field relative">
    <div
      class="wsh-chips box-border flex w-full min-h-[38px] flex-wrap items-center gap-1.5 border border-[var(--color-border,#ccc)] bg-[var(--bg,#fff)] px-2 py-1.5"
    >
      {#each selected as g (g.key)}
        <span
          class={cn(
            'wsh-chip inline-flex max-w-full items-baseline gap-1.5 bg-[color-mix(in_srgb,var(--accent,#2563eb)_12%,transparent)] py-[3px] pl-2 pr-1.5 text-xs leading-snug text-foreground',
            !g.email && 'wsh-chip-warn bg-[color-mix(in_srgb,var(--danger,#b42318)_14%,transparent)]',
          )}
          title={tooltipFor(g)}
        >
          <span class="wsh-chip-label font-semibold">
            {g.handle ? `@${g.handle}` : g.email}
          </span>
          {#if g.displayName || g.email}
            <span
              class="wsh-chip-meta max-w-[220px] overflow-hidden whitespace-nowrap text-ellipsis text-[11px] text-muted"
            >
              {g.displayName ?? ''}{g.displayName && g.email ? ' · ' : ''}{g.email ?? ''}
            </span>
          {/if}
          <button
            type="button"
            class="wsh-chip-x cursor-pointer border-none bg-transparent px-0.5 text-sm leading-none text-inherit"
            aria-label={`Remove ${g.handle ? '@' + g.handle : g.email}`}
            onclick={() => removeChip(g.key)}
          >×</button>
        </span>
      {/each}
      <input
        id="wsh-grantees"
        class="wsh-chip-input min-w-[140px] flex-1 border-none bg-transparent px-0.5 py-1 text-[13px] text-inherit [font:inherit] focus:outline-none"
        type="text"
        autocomplete="off"
        spellcheck="false"
        placeholder={selected.length === 0 ? '@username or you@example.com' : ''}
        bind:this={inputEl}
        bind:value={inputValue}
        oninput={onInput}
        onkeydown={onKeydown}
        onpaste={onPaste}
        disabled={submitting}
      />
    </div>
    {#if suggestOpen && (suggestions.length > 0 || suggestLoading)}
      <div
        class="wsh-suggest absolute inset-x-0 top-full z-10 mt-1 max-h-[220px] overflow-y-auto border border-[var(--color-border,#ccc)] bg-[var(--bg-3,#fff)] shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
        role="listbox"
      >
        {#if suggestLoading && suggestions.length === 0}
          <div class="wsh-suggest-empty px-2.5 py-2 text-xs text-muted">Searching…</div>
        {/if}
        {#each suggestions as s, i (s.userId)}
          <button
            type="button"
            role="option"
            aria-selected={i === suggestIndex}
            class={cn(
              'wsh-suggest-item grid w-full cursor-pointer grid-cols-[auto_1fr_auto] items-baseline gap-x-2 border-none bg-transparent px-2.5 py-1.5 text-left text-inherit [font:inherit] hover:bg-[var(--accent-dim,rgba(37,99,235,0.12))]',
              i === suggestIndex && 'selected bg-[var(--accent-dim,rgba(37,99,235,0.12))]',
            )}
            onmousedown={(e) => {
              e.preventDefault()
              selectFromDirectory(s)
            }}
          >
            <span class="wsh-suggest-handle text-[13px] font-semibold">@{s.handle}</span>
            {#if s.displayName}
              <span
                class="wsh-suggest-name overflow-hidden whitespace-nowrap text-ellipsis text-[13px] text-foreground"
                >{s.displayName}</span
              >
            {/if}
            <span
              class="wsh-suggest-email overflow-hidden whitespace-nowrap text-ellipsis text-xs text-muted"
            >
              {s.primaryEmail ?? 'No email on file'}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
  {#if selected.some((g) => !g.email)}
    <p class="wsh-hint wsh-hint-warn mt-2 text-[13px] text-[var(--danger,#b42318)]">
      Add an email to their workspace before they can receive invites.
    </p>
  {/if}
  {#if Object.keys(perGranteeErrors).length > 0}
    <ul class="wsh-err-list m-0 mt-2 list-none p-0">
      {#each Object.entries(perGranteeErrors) as [key, msg] (key)}
        <li class="{errBase} mt-1">{key}: {msg}</li>
      {/each}
    </ul>
  {/if}
  {#if errorMsg}
    <p class={errBase} role="alert">{errorMsg}</p>
  {/if}
</ConfirmDialog>

<ConfirmDialog
  open={revokeTarget !== null}
  titleId="wiki-share-revoke-title"
  title="Stop sharing?"
  confirmVariant="danger"
  confirmLabel="Remove"
  cancelLabel="Cancel"
  onDismiss={() => {
    revokeTarget = null
  }}
  onConfirm={() => void runRevokeAccess()}
>
  <p class="wsh-revoke-lead m-0 mb-2 text-sm leading-snug">
    {#if targetKind === 'dir'}
      They won’t be able to view this folder or anything inside{' '}
      <span class={sharePathName} translate="no">
        <WikiFileName path={wikiShareDisplayPathForFileName} />
      </span>.
    {:else}
      They won’t be able to view{' '}
      <span class={sharePathName} translate="no">
        <WikiFileName path={wikiShareDisplayPathForFileName} />
      </span>.
    {/if}
  </p>
  {#if revokeTarget}
    <p class="wsh-revoke-detail m-0 text-[13px] text-muted">
      <strong>{revokeTarget.granteeEmail}</strong>
    </p>
  {/if}
</ConfirmDialog>
