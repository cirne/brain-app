<script lang="ts">
  import { onMount } from 'svelte'
  import { Users } from 'lucide-svelte'

  type GrantRow = {
    id: string
    ownerId: string
    ownerHandle: string
    askerId: string
    askerHandle?: string
    privacyPolicy: string
    createdAtMs: number
    updatedAtMs: number
  }

  type LogRow = {
    id: string
    ownerId: string
    askerId: string
    question: string
    draftAnswer?: string | null
    finalAnswer: string | null
    filterNotes: string | null
    status: string
    createdAtMs: number
    durationMs: number | null
  }

  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let grantedByMe = $state<GrantRow[]>([])
  let grantedToMe = $state<GrantRow[]>([])
  let newHandle = $state('')
  let revokeBusyId = $state<string | null>(null)
  let saveBusyId = $state<string | null>(null)
  /** Local edit buffer: grant id → policy text */
  let policyDraft = $state<Record<string, string>>({})

  let logOwner = $state<LogRow[]>([])
  let logAsker = $state<LogRow[]>([])

  function parseGrants(json: unknown): { grantedByMe: GrantRow[]; grantedToMe: GrantRow[] } | null {
    if (!json || typeof json !== 'object') return null
    const o = json as Record<string, unknown>
    const a = o.grantedByMe
    const b = o.grantedToMe
    if (!Array.isArray(a) || !Array.isArray(b)) return null
    const map = (x: unknown): GrantRow | null => {
      if (!x || typeof x !== 'object') return null
      const r = x as Record<string, unknown>
      if (
        typeof r.id !== 'string' ||
        typeof r.ownerId !== 'string' ||
        typeof r.ownerHandle !== 'string' ||
        typeof r.askerId !== 'string' ||
        typeof r.privacyPolicy !== 'string' ||
        typeof r.createdAtMs !== 'number' ||
        typeof r.updatedAtMs !== 'number'
      ) {
        return null
      }
      const askerHandle = typeof r.askerHandle === 'string' ? r.askerHandle : undefined
      return {
        id: r.id,
        ownerId: r.ownerId,
        ownerHandle: r.ownerHandle,
        askerId: r.askerId,
        ...(askerHandle ? { askerHandle } : {}),
        privacyPolicy: r.privacyPolicy,
        createdAtMs: r.createdAtMs,
        updatedAtMs: r.updatedAtMs,
      }
    }
    return {
      grantedByMe: a.map(map).filter((x): x is GrantRow => x !== null),
      grantedToMe: b.map(map).filter((x): x is GrantRow => x !== null),
    }
  }

  function parseLog(json: unknown): LogRow[] {
    if (!json || typeof json !== 'object') return []
    const o = json as Record<string, unknown>
    const entries = o.entries
    if (!Array.isArray(entries)) return []
    return entries
      .map((x): LogRow | null => {
        if (!x || typeof x !== 'object') return null
        const r = x as Record<string, unknown>
        if (
          typeof r.id !== 'string' ||
          typeof r.ownerId !== 'string' ||
          typeof r.askerId !== 'string' ||
          typeof r.question !== 'string' ||
          typeof r.status !== 'string' ||
          typeof r.createdAtMs !== 'number'
        ) {
          return null
        }
        const draftAnswer = 'draftAnswer' in r ? r.draftAnswer : null
        return {
          id: r.id,
          ownerId: r.ownerId,
          askerId: r.askerId,
          question: r.question,
          draftAnswer: typeof draftAnswer === 'string' ? draftAnswer : null,
          finalAnswer: typeof r.finalAnswer === 'string' || r.finalAnswer === null ? (r.finalAnswer as string | null) : null,
          filterNotes: typeof r.filterNotes === 'string' || r.filterNotes === null ? (r.filterNotes as string | null) : null,
          status: r.status,
          createdAtMs: r.createdAtMs,
          durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
        }
      })
      .filter((x): x is LogRow => x !== null)
  }

  async function reload(): Promise<void> {
    loadError = null
    busy = true
    try {
      const [gRes, loRes, laRes] = await Promise.all([
        fetch('/api/brain-query/grants'),
        fetch('/api/brain-query/log?role=owner&limit=30'),
        fetch('/api/brain-query/log?role=asker&limit=30'),
      ])
      if (!gRes.ok) {
        loadError = (await gRes.text()) || 'Failed to load brain query grants.'
        return
      }
      const gj = await gRes.json()
      const parsed = parseGrants(gj)
      if (!parsed) {
        loadError = 'Invalid grants response.'
        return
      }
      grantedByMe = parsed.grantedByMe
      grantedToMe = parsed.grantedToMe
      const nextDraft: Record<string, string> = { ...policyDraft }
      for (const r of grantedByMe) {
        if (nextDraft[r.id] === undefined) nextDraft[r.id] = r.privacyPolicy
      }
      policyDraft = nextDraft

      if (loRes.ok) {
        logOwner = parseLog(await loRes.json())
      }
      if (laRes.ok) {
        logAsker = parseLog(await laRes.json())
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  onMount(() => {
    void reload()
  })

  async function addGrant(): Promise<void> {
    const h = newHandle.trim()
    if (!h) return
    loadError = null
    busy = true
    try {
      const res = await fetch('/api/brain-query/grants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ askerHandle: h }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        loadError = j.message ?? j.error ?? `Grant failed (${res.status})`
        return
      }
      newHandle = ''
      await reload()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function savePolicy(id: string): Promise<void> {
    const text = policyDraft[id]?.trim() ?? ''
    if (!text) return
    saveBusyId = id
    loadError = null
    try {
      const res = await fetch(`/api/brain-query/grants/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ privacyPolicy: text }),
      })
      if (!res.ok) {
        loadError = `Save failed (${res.status})`
        return
      }
      await reload()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      saveBusyId = null
    }
  }

  async function revoke(id: string): Promise<void> {
    revokeBusyId = id
    loadError = null
    try {
      const res = await fetch(`/api/brain-query/grants/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        loadError = `Revoke failed (${res.status})`
        return
      }
      await reload()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      revokeBusyId = null
    }
  }

  function formatTs(ms: number): string {
    try {
      return new Date(ms).toLocaleString()
    } catch {
      return String(ms)
    }
  }

  const shareSubhead = 'm-0 text-[0.8125rem] font-bold uppercase tracking-[0.06em] text-muted'
  const shareRow = 'flex flex-col gap-2 rounded-lg border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-2 p-3 sm:flex-row sm:items-start sm:justify-between'
  const shareBtn =
    'rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-3 py-1.5 text-[0.8125rem] font-semibold text-foreground hover:bg-surface-2'
  const shareBtnDanger =
    'border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400'
</script>

<div class="settings-share-block flex flex-col gap-3" id="settings-brain-query">
  <div class="flex items-center gap-2">
    <Users size={16} class="text-muted" aria-hidden="true" />
    <h3 class={shareSubhead}>Brain queries</h3>
  </div>
  <p class="m-0 max-w-[40rem] text-[0.875rem] leading-[1.45] text-muted">
    Let collaborators use the <strong>ask_brain</strong> tool in chat to ask your assistant a question. Answers pass through a
    <strong>privacy policy</strong> you control per person. Raw mail/wiki text does not leave your workspace—only filtered
    replies.
  </p>
  {#if loadError}
    <p class="m-0 text-[0.875rem] text-red-600 dark:text-red-400" role="alert">{loadError}</p>
  {/if}

  <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
    <label class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="text-[0.75rem] font-semibold uppercase tracking-wide text-muted">Grant query access to @handle</span>
      <input
        type="text"
        class="rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-1 px-3 py-2 text-[0.875rem] text-foreground"
        placeholder="colleague"
        bind:value={newHandle}
        disabled={busy}
        autocomplete="off"
      />
    </label>
    <button type="button" class={shareBtn} disabled={busy || !newHandle.trim()} onclick={() => void addGrant()}>
      {busy ? 'Working…' : 'Grant access'}
    </button>
    <button type="button" class={shareBtn} disabled={busy} onclick={() => void reload()}>Refresh</button>
  </div>

  <div class="flex flex-col gap-2">
    <h4 class="m-0 text-[0.8125rem] font-semibold text-foreground">Who can query your brain</h4>
    {#if grantedByMe.length === 0}
      <p class="m-0 text-[0.875rem] text-muted">No brain-query grants yet.</p>
    {:else}
      <ul class="m-0 flex list-none flex-col gap-3 p-0">
        {#each grantedByMe as row (row.id)}
          <li class={shareRow}>
            <div class="min-w-0 flex-1 flex flex-col gap-2">
              <span class="text-[0.875rem] font-medium text-foreground">
                @{row.askerHandle ?? row.askerId}
              </span>
              <label class="flex flex-col gap-1">
                <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">Privacy policy</span>
                <textarea
                  class="min-h-[7rem] w-full rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-1 p-2 font-mono text-[0.75rem] leading-snug text-foreground"
                  value={policyDraft[row.id] ?? ''}
                  disabled={saveBusyId === row.id}
                  oninput={(ev) => {
                    const v = (ev.currentTarget as HTMLTextAreaElement).value
                    policyDraft = { ...policyDraft, [row.id]: v }
                  }}
                ></textarea>
              </label>
            </div>
            <div class="flex flex-shrink-0 flex-col gap-2 sm:items-end">
              <button
                type="button"
                class={shareBtn}
                disabled={saveBusyId === row.id}
                onclick={() => void savePolicy(row.id)}
              >
                {saveBusyId === row.id ? 'Saving…' : 'Save policy'}
              </button>
              <button
                type="button"
                class={`${shareBtn} ${shareBtnDanger}`}
                disabled={revokeBusyId !== null}
                onclick={() => void revoke(row.id)}
              >
                {revokeBusyId === row.id ? 'Revoking…' : 'Revoke'}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <h4 class="m-0 text-[0.8125rem] font-semibold text-foreground">Brains you may query</h4>
    {#if grantedToMe.length === 0}
      <p class="m-0 text-[0.875rem] text-muted">No one has granted you query access yet.</p>
    {:else}
      <ul class="m-0 list-none space-y-2 p-0">
        {#each grantedToMe as row (row.id)}
          <li class="rounded-lg border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-2 px-3 py-2 text-[0.875rem]">
            <span class="font-medium">@{row.ownerHandle}</span>
            <span class="text-muted"> — use <code class="rounded bg-surface-1 px-1">ask_brain</code> in chat</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <h4 class="m-0 text-[0.8125rem] font-semibold text-foreground">Query log (your brain — inbound)</h4>
    <p class="m-0 text-[0.8125rem] text-muted">Who asked, draft vs filtered answer, and status. Visible only to you.</p>
    {#if logOwner.length === 0}
      <p class="m-0 text-[0.875rem] text-muted">No queries yet.</p>
    {:else}
      <ul class="m-0 flex max-h-64 list-none flex-col gap-2 overflow-y-auto p-0">
        {#each logOwner as e (e.id)}
          <li class="rounded border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-surface-1 p-2 text-[0.75rem]">
            <div class="font-semibold text-foreground">{formatTs(e.createdAtMs)} · {e.status}</div>
            <div class="text-muted">From asker: <span class="font-mono">{e.askerId}</span></div>
            <div class="mt-1 text-foreground"><strong>Q:</strong> {e.question}</div>
            {#if e.draftAnswer}
              <div class="mt-1 text-muted"><strong>Draft:</strong> {e.draftAnswer}</div>
            {/if}
            {#if e.finalAnswer}
              <div class="mt-1 text-foreground"><strong>Sent:</strong> {e.finalAnswer}</div>
            {/if}
            {#if e.filterNotes}
              <div class="mt-1 text-muted"><strong>Notes:</strong> {e.filterNotes}</div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    <h4 class="m-0 text-[0.8125rem] font-semibold text-foreground">Your outbound questions</h4>
    {#if logAsker.length === 0}
      <p class="m-0 text-[0.875rem] text-muted">You have not sent any brain queries yet.</p>
    {:else}
      <ul class="m-0 flex max-h-48 list-none flex-col gap-2 overflow-y-auto p-0">
        {#each logAsker as e (e.id)}
          <li class="rounded border border-[color-mix(in_srgb,var(--border)_60%,transparent)] bg-surface-1 p-2 text-[0.75rem]">
            <div class="font-semibold text-foreground">{formatTs(e.createdAtMs)} · {e.status}</div>
            <div class="text-muted">To: <span class="font-mono">{e.ownerId}</span></div>
            <div class="mt-1 text-foreground"><strong>Q:</strong> {e.question}</div>
            {#if e.finalAnswer}
              <div class="mt-1 text-foreground"><strong>Answer:</strong> {e.finalAnswer}</div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
