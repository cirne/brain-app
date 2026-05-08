<script lang="ts">
  import { onMount } from 'svelte'
  import { ShieldCheck } from 'lucide-svelte'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import {
    loadBrainAccessCustomPolicies,
    type BrainAccessCustomPolicy,
  } from '@client/lib/brainAccessCustomPolicies.js'
  import {
    buildPolicyCardModels,
    classifyGrantPolicy,
    ownerLogEntriesForPolicy,
    type BrainAccessGrantRow,
    type BrainAccessLogRow,
    type PolicyCardModel,
  } from '@client/lib/brainAccessPolicyGrouping.js'
  import type { WorkspaceHandleEntry } from '@client/lib/workspaceHandleSuggest.js'
  import PolicyCard from './PolicyCard.svelte'
  import OutboundGrantsList from './OutboundGrantsList.svelte'
  import ChangePolicyDialog from './ChangePolicyDialog.svelte'
  import CustomPolicyCreator from './CustomPolicyCreator.svelte'
  import BrainAccessBreadcrumbs from './BrainAccessBreadcrumbs.svelte'
  import PaneL2Header from '@components/PaneL2Header.svelte'

  type Props = {
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    /** Return to `/settings` home (no overlay). */
    onBackToSettingsMain: () => void
  }

  let { onSettingsNavigate, onBackToSettingsMain }: Props = $props()

  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let grantedByMe = $state<BrainAccessGrantRow[]>([])
  let grantedToMe = $state<BrainAccessGrantRow[]>([])
  let logOwner = $state<BrainAccessLogRow[]>([])
  let customPolicies = $state<BrainAccessCustomPolicy[]>([])
  let removeBusyId = $state<string | null>(null)
  let changeGrantId = $state<string | null>(null)
  let createCustomOpen = $state(false)
  let addBusy = $state(false)

  function readCustomPolicies(): BrainAccessCustomPolicy[] {
    return loadBrainAccessCustomPolicies()
  }

  function parseGrants(json: unknown): { grantedByMe: BrainAccessGrantRow[]; grantedToMe: BrainAccessGrantRow[] } | null {
    if (!json || typeof json !== 'object') return null
    const o = json as Record<string, unknown>
    const a = o.grantedByMe
    const b = o.grantedToMe
    if (!Array.isArray(a) || !Array.isArray(b)) return null
    const map = (x: unknown): BrainAccessGrantRow | null => {
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
      grantedByMe: a.map(map).filter((x): x is BrainAccessGrantRow => x !== null),
      grantedToMe: b.map(map).filter((x): x is BrainAccessGrantRow => x !== null),
    }
  }

  function parseLog(json: unknown): BrainAccessLogRow[] {
    if (!json || typeof json !== 'object') return []
    const o = json as Record<string, unknown>
    const entries = o.entries
    if (!Array.isArray(entries)) return []
    return entries
      .map((x): BrainAccessLogRow | null => {
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
          finalAnswer:
            typeof r.finalAnswer === 'string' || r.finalAnswer === null ? (r.finalAnswer as string | null) : null,
          filterNotes:
            typeof r.filterNotes === 'string' || r.filterNotes === null ? (r.filterNotes as string | null) : null,
          status: r.status,
          createdAtMs: r.createdAtMs,
          durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
        }
      })
      .filter((x): x is BrainAccessLogRow => x !== null)
  }

  async function reload(): Promise<void> {
    loadError = null
    busy = true
    customPolicies = readCustomPolicies()
    try {
      const [gRes, loRes] = await Promise.all([
        fetch('/api/brain-query/grants'),
        fetch('/api/brain-query/log?role=owner&limit=80'),
      ])
      if (!gRes.ok) {
        loadError = (await gRes.text()) || 'Failed to load brain query grants.'
        return
      }
      const parsed = parseGrants(await gRes.json())
      if (!parsed) {
        loadError = 'Invalid grants response.'
        return
      }
      grantedByMe = parsed.grantedByMe
      grantedToMe = parsed.grantedToMe
      if (loRes.ok) {
        logOwner = parseLog(await loRes.json())
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

  const policyCards = $derived(buildPolicyCardModels(grantedByMe, customPolicies))

  function activityCount(model: PolicyCardModel): number {
    return ownerLogEntriesForPolicy(logOwner, grantedByMe, customPolicies, model.policyId).length
  }

  async function addUser(canonicalText: string, entry: WorkspaceHandleEntry): Promise<void> {
    loadError = null
    addBusy = true
    try {
      const res = await fetch('/api/brain-query/grants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          askerHandle: entry.handle,
          privacyPolicy: canonicalText,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        loadError = j.message ?? j.error ?? `Couldn’t add @${entry.handle}.`
        return
      }
      await reload()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      addBusy = false
    }
  }

  async function removeGrant(id: string): Promise<void> {
    removeBusyId = id
    loadError = null
    try {
      const res = await fetch(`/api/brain-query/grants/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) {
        loadError = `Remove failed (${res.status})`
        return
      }
      await reload()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      removeBusyId = null
    }
  }

  async function patchGrantPrivacy(grantId: string, privacyPolicy: string): Promise<void> {
    loadError = null
    busy = true
    try {
      const res = await fetch(`/api/brain-query/grants/${encodeURIComponent(grantId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ privacyPolicy }),
      })
      if (!res.ok) {
        loadError = `Update failed (${res.status})`
        return
      }
      await reload()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  const changeExcludePolicyId = $derived.by(() => {
    const gid = changeGrantId
    if (!gid) return undefined
    const row = grantedByMe.find((g) => g.id === gid)
    if (!row) return undefined
    return classifyGrantPolicy(row.privacyPolicy, customPolicies).policyId
  })
</script>

<div class="brain-access-page mx-auto flex w-full max-w-[900px] flex-col gap-6 px-8 pb-6 pt-0 text-foreground max-md:px-4 max-md:pb-4 max-md:pt-0">
  <h1 class="sr-only">Brain to Brain access</h1>
  <div class="-mx-8 min-w-0 max-md:-mx-4">
    <PaneL2Header>
      {#snippet center()}
        <div class="flex min-h-0 min-w-0 flex-1 items-center">
          <BrainAccessBreadcrumbs variant="list" />
        </div>
      {/snippet}
    </PaneL2Header>
  </div>
  <div class="flex items-start gap-2">
    <ShieldCheck size={16} class="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
    <p class="m-0 max-w-[42rem] text-[0.875rem] leading-relaxed text-muted">
      Map collaborators to a policy; your assistant uses that policy before answering cross-brain questions.
    </p>
  </div>

  {#if loadError}
    <p class="m-0 text-[0.875rem] text-red-600 dark:text-red-400" role="alert">{loadError}</p>
  {/if}

  <section aria-labelledby="brain-access-policies-heading" class="flex flex-col gap-4">
    <h2 id="brain-access-policies-heading" class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">
      Policies &amp; collaborators
    </h2>
    {#if busy && grantedByMe.length === 0 && grantedToMe.length === 0}
      <p class="m-0 text-[0.875rem] text-muted">Loading…</p>
    {:else}
      {#each policyCards as model (model.policyId)}
        <PolicyCard
          {model}
          policyActivityCount={activityCount(model)}
          {onSettingsNavigate}
          onAddUser={(text, entry) => void addUser(text, entry)}
          onRemoveGrant={(id) => void removeGrant(id)}
          onOpenChangePolicy={(id) => {
            changeGrantId = id
          }}
          removeBusyId={removeBusyId}
          addBusy={addBusy}
        />
      {/each}
    {/if}

    <button
      type="button"
      class="rounded-lg border border-dashed border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface-2 px-4 py-3 text-[0.875rem] font-semibold text-foreground hover:bg-surface-3"
      onclick={() => {
        createCustomOpen = true
      }}
    >
      + Create custom policy
    </button>
  </section>

  <OutboundGrantsList
    grantedToMe={grantedToMe}
    customPolicies={customPolicies}
    onRemoveInbound={(id) => void removeGrant(id)}
    removeBusyId={removeBusyId}
  />

  <div class="flex flex-wrap gap-2">
    <button
      type="button"
      class="rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-3 py-1.5 text-[0.8125rem] font-semibold text-foreground hover:bg-surface-2"
      disabled={busy}
      onclick={() => void reload()}
    >
      Refresh
    </button>
    <button
      type="button"
      class="rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-3 py-1.5 text-[0.8125rem] font-semibold text-foreground hover:bg-surface-2"
      onclick={() => onBackToSettingsMain()}
    >
      ← Back to Settings
    </button>
  </div>
</div>

<ChangePolicyDialog
  open={changeGrantId !== null}
  grantId={changeGrantId}
  customPolicies={customPolicies}
  excludePolicyId={changeExcludePolicyId}
  onDismiss={() => {
    changeGrantId = null
  }}
  onApply={(grantId, text) => patchGrantPrivacy(grantId, text)}
/>

<CustomPolicyCreator
  open={createCustomOpen}
  onDismiss={() => {
    createCustomOpen = false
  }}
  onCreated={() => {
    customPolicies = readCustomPolicies()
    void reload()
  }}
/>
