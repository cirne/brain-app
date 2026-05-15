<script lang="ts">
  import { onMount } from 'svelte'
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import { fetchWorkspaceHandleSuggestions } from '@client/lib/workspaceHandleSuggest.js'
  import type { WorkspaceHandleEntry } from '@client/lib/workspaceHandleSuggest.js'
  import { t } from '@client/lib/i18n/index.js'
  import {
    removeBrainAccessCustomPolicy,
    updateBrainAccessCustomPolicy,
    fetchBrainAccessCustomPoliciesFromServer,
    mergeServerAndLegacyCustomPolicies,
    type BrainAccessCustomPolicy,
  } from '@client/lib/brainAccessCustomPolicies.js'
  import { isBrainQueryBuiltinTemplateId } from '@client/lib/brainQueryPolicyTemplates.js'
  import { policyCardTone } from './policyColors.js'
  import UserDetailRow from './UserDetailRow.svelte'
  import AddUserDropdown from './AddUserDropdown.svelte'
  import ChangePolicyDialog from './ChangePolicyDialog.svelte'
  import BrainQueryPolicyBaselineNote from './BrainQueryPolicyBaselineNote.svelte'
  import BrainAccessBreadcrumbs from './BrainAccessBreadcrumbs.svelte'
  import ConfirmDialog from '@client/components/ConfirmDialog.svelte'
  import PaneL2Header from '@components/PaneL2Header.svelte'

  type Props = {
    policyId: string
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    onBackToBrainAccessList: () => void
    /** Navigate to `/settings` root (settings hierarchy). */
    onNavigateToSettingsRoot: () => void
  }

  /** Read props via proxy — do not destructure callbacks for async/use after await (Svelte 5 freezes destructured snapshots). */
  let props: Props = $props()

  let loadError = $state<string | null>(null)
  let busy = $state(false)
  let grantedByMe = $state<BrainAccessGrantRow[]>([])
  let customPolicies = $state<BrainAccessCustomPolicy[]>([])
  let profileByHandle = $state<Record<string, { displayName?: string; email?: string | null }>>({})
  let removeBusyId = $state<string | null>(null)
  let autoSendBusyId = $state<string | null>(null)
  let editingPolicyText = $state(false)
  let draftPolicyText = $state('')
  let draftPolicyTitle = $state('')
  let changeGrantId = $state<string | null>(null)
  let addBusy = $state(false)
  let pendingDeletePreset = $state<{ label: string } | null>(null)

  let searchToken = 0

  function parseGrantsFull(json: unknown): { grantedByMe: BrainAccessGrantRow[] } | null {
    if (!json || typeof json !== 'object') return null
    const o = json as Record<string, unknown>
    const a = o.grantedByMe
    if (!Array.isArray(a)) return null
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
      const autoSend = r.autoSend === true
      const replyRaw = r.replyMode
      const replyMode =
        replyRaw === 'auto' || replyRaw === 'review' || replyRaw === 'ignore' ? replyRaw : undefined
      const pkRaw = r.presetPolicyKey
      const presetPolicyKey = typeof pkRaw === 'string' && pkRaw.trim() ? pkRaw.trim() : null
      const cRaw = r.customPolicyId
      const customPolicyId = typeof cRaw === 'string' && cRaw.trim() ? cRaw.trim() : null
      return {
        id: r.id,
        ownerId: r.ownerId,
        ownerHandle: r.ownerHandle,
        askerId: r.askerId,
        ...(askerHandle ? { askerHandle } : {}),
        privacyPolicy: r.privacyPolicy,
        presetPolicyKey,
        customPolicyId,
        ...(replyMode ? { replyMode } : {}),
        createdAtMs: r.createdAtMs,
        updatedAtMs: r.updatedAtMs,
        ...(autoSend ? { autoSend: true } : {}),
      }
    }
    return {
      grantedByMe: a.map(map).filter((x): x is BrainAccessGrantRow => x !== null),
    }
  }

  async function hydrateProfiles(grants: BrainAccessGrantRow[]): Promise<void> {
    const handles = [...new Set(grants.map((g) => (g.askerHandle ?? '').trim()).filter(Boolean))]
    const next: Record<string, { displayName?: string; email?: string | null }> = { ...profileByHandle }
    for (const h of handles) {
      const low = h.toLowerCase()
      if (next[low]) continue
      const myToken = ++searchToken
      const { token, results } = await fetchWorkspaceHandleSuggestions(low, myToken)
      if (token !== searchToken) continue
      const hit = results.find((r) => r.handle.toLowerCase() === low) ?? results[0]
      if (hit) next[low] = { displayName: hit.displayName, email: hit.primaryEmail }
    }
    profileByHandle = next
  }

  async function reload(): Promise<void> {
    loadError = null
    busy = true
    const customsRemote = await fetchBrainAccessCustomPoliciesFromServer()
    customPolicies = mergeServerAndLegacyCustomPolicies(customsRemote)
    try {
      const gRes = await fetch('/api/brain-query/grants')
      if (!gRes.ok) {
        loadError = (await gRes.text()) || $t('access.policyDetailPage.errors.failedToLoadGrants')
        return
      }
      const parsed = parseGrantsFull(await gRes.json())
      if (!parsed) {
        loadError = $t('access.policyDetailPage.errors.invalidGrantsResponse')
        return
      }
      grantedByMe = parsed.grantedByMe
      const inPolicy = grantsMatchingPolicyId(grantedByMe, customPolicies, props.policyId)
      await hydrateProfiles(inPolicy)
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  onMount(() => {
    void reload().then(() => {
      queueMicrotask(() => {
        const hash = typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : ''
        if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' })
      })
    })
  })

  const cardModels = $derived(buildPolicyCardModels(grantedByMe, customPolicies))
  const card = $derived(cardModels.find((c) => c.policyId === props.policyId))

  const grantsInPolicy = $derived(grantsMatchingPolicyId(grantedByMe, customPolicies, props.policyId))

  const tone = $derived(
    card
      ? policyCardTone({
          kind: card.kind,
          builtinId: card.builtinId,
          colorIndex: card.colorIndex,
          policyId: card.policyId,
        })
      : policyCardTone({ kind: 'adhoc', policyId: props.policyId }),
  )

  const canonical = $derived.by(() => {
    if (grantsInPolicy.length > 0) {
      return card?.canonicalText ?? grantsInPolicy[0]?.privacyPolicy ?? ''
    }
    return card?.canonicalText ?? ''
  })

  const isBuiltinPreset = $derived(card?.kind === 'builtin')
  /** Built-in templates are server-defined; custom and ad-hoc rows can edit title + body. */
  const policyTextEditable = $derived(!isBuiltinPreset)
  async function addUser(entry: WorkspaceHandleEntry): Promise<void> {
    if (!card) return
    addBusy = true
    loadError = null
    try {
      let grantBody: Record<string, string> = { askerHandle: entry.handle }
      if (card.kind === 'builtin') {
        grantBody.presetPolicyKey = card.policyId
      } else if (card.kind === 'custom') {
        grantBody.customPolicyId = card.policyId
      } else {
        const text = canonical.trim()
        if (!text) {
          loadError = $t('access.policyDetailPage.errors.missingPolicyText')
          return
        }
        const pr = await fetch('/api/brain-query/policies', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: (heading || 'Policy').slice(0, 120),
            body: text,
          }),
        })
        if (!pr.ok) {
          const j = (await pr.json().catch(() => ({}))) as { message?: string; error?: string }
          loadError = j.message ?? j.error ?? $t('access.policyDetailPage.errors.couldNotAddHandle', { handle: entry.handle })
          return
        }
        const created = (await pr.json()) as { id?: string }
        if (!created.id) {
          loadError = $t('access.policyDetailPage.errors.couldNotAddHandle', { handle: entry.handle })
          return
        }
        grantBody.customPolicyId = created.id
      }
      const res = await fetch('/api/brain-query/grants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(grantBody),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        loadError = j.message ?? j.error ?? $t('access.policyDetailPage.errors.couldNotAddHandle', { handle: entry.handle })
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
        loadError = $t('access.policyDetailPage.errors.removeFailed', { status: res.status })
        return
      }
      await reload()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      removeBusyId = null
    }
  }

  async function patchGrantAutoSend(grantId: string, autoSend: boolean): Promise<void> {
    autoSendBusyId = grantId
    loadError = null
    try {
      const res = await fetch(`/api/chat/b2b/grants/${encodeURIComponent(grantId)}/auto-send`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSend }),
      })
      if (!res.ok) {
        loadError = $t('access.policyDetailPage.errors.updateFailed', { status: res.status })
        return
      }
      grantedByMe = grantedByMe.map((g) => (g.id === grantId ? { ...g, autoSend } : g))
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      autoSendBusyId = null
    }
  }

  async function patchGrantToPolicyTarget(grantId: string, targetPolicyId: string): Promise<boolean> {
    const body = isBrainQueryBuiltinTemplateId(targetPolicyId)
      ? { presetPolicyKey: targetPolicyId }
      : { customPolicyId: targetPolicyId }
    const res = await fetch(`/api/brain-query/grants/${encodeURIComponent(grantId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.ok
  }

  async function saveAllPolicyText(text: string): Promise<void> {
    const trimmed = text.trim()
    if (trimmed.length === 0) return

    const list = grantsInPolicy

    if (list.length > 0) {
      busy = true
      loadError = null
      try {
        let navigatedPolicyId: string | undefined

        if (card?.kind === 'builtin') {
          const template = BRAIN_QUERY_POLICY_TEMPLATES.find((t) => t.id === props.policyId)
          const matchesBuiltin =
            template != null && normalizePolicyText(trimmed) === normalizePolicyText(template.text)
          if (matchesBuiltin) {
            for (const g of list) {
              if (!(await patchGrantToPolicyTarget(g.id, props.policyId))) {
                loadError = $t('access.policyDetailPage.errors.saveFailed', { status: 500 })
                return
              }
            }
            clearBuiltinPolicyDraft(props.policyId)
            navigatedPolicyId = props.policyId
          } else {
            const pr = await fetch('/api/brain-query/policies', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                label: (heading || 'Policy').slice(0, 120),
                body: trimmed,
              }),
            })
            if (!pr.ok) {
              loadError = $t('access.policyDetailPage.errors.saveFailed', { status: pr.status })
              return
            }
            const created = (await pr.json()) as { id?: string }
            if (!created.id) {
              loadError = $t('access.policyDetailPage.errors.saveFailed', { status: 500 })
              return
            }
            for (const g of list) {
              if (!(await patchGrantToPolicyTarget(g.id, created.id))) {
                loadError = $t('access.policyDetailPage.errors.saveFailed', { status: 500 })
                return
              }
            }
            clearBuiltinPolicyDraft(props.policyId)
            navigatedPolicyId = created.id
          }
        } else if (card?.kind === 'custom' && props.policyId.startsWith('bqc_')) {
          const res = await fetch(`/api/brain-query/policies/${encodeURIComponent(props.policyId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ body: trimmed }),
          })
          if (!res.ok) {
            loadError = $t('access.policyDetailPage.errors.saveFailed', { status: res.status })
            return
          }
          navigatedPolicyId = props.policyId
        } else {
          const pr = await fetch('/api/brain-query/policies', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              label: (heading || 'Policy').slice(0, 120),
              body: trimmed,
            }),
          })
          if (!pr.ok) {
            loadError = $t('access.policyDetailPage.errors.saveFailed', { status: pr.status })
            return
          }
          const created = (await pr.json()) as { id?: string }
          if (!created.id) {
            loadError = $t('access.policyDetailPage.errors.saveFailed', { status: 500 })
            return
          }
          for (const g of list) {
            if (!(await patchGrantToPolicyTarget(g.id, created.id))) {
              loadError = $t('access.policyDetailPage.errors.saveFailed', { status: 500 })
              return
            }
          }
          navigatedPolicyId = created.id
        }

        editingPolicyText = false
        await reload()
        if (navigatedPolicyId !== undefined && navigatedPolicyId !== props.policyId) {
          props.onSettingsNavigate({ type: 'brain-access-policy', policyId: navigatedPolicyId }, { replace: true })
        }
      } catch (e) {
        loadError = e instanceof Error ? e.message : String(e)
      } finally {
        busy = false
      }
      return
    }

    busy = true
    loadError = null
    try {
      if (card?.kind === 'custom' && props.policyId.startsWith('custom:')) {
        if (!updateBrainAccessCustomPolicy(props.policyId, trimmed)) {
          loadError = $t('access.policyDetailPage.errors.couldNotUpdateSavedPolicy')
          return
        }
      } else if (card?.kind === 'custom' && props.policyId.startsWith('bqc_')) {
        const res = await fetch(`/api/brain-query/policies/${encodeURIComponent(props.policyId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: trimmed }),
        })
        if (!res.ok) {
          loadError = $t('access.policyDetailPage.errors.saveFailed', { status: res.status })
          return
        }
      } else if (card?.kind === 'builtin') {
        const tpl = BRAIN_QUERY_POLICY_TEMPLATES.find((t) => t.id === props.policyId)
        if (tpl && normalizePolicyText(trimmed) === normalizePolicyText(tpl.text)) {
          clearBuiltinPolicyDraft(props.policyId)
        } else {
          saveBuiltinPolicyDraft(props.policyId, trimmed)
        }
      } else {
        loadError = $t('access.policyDetailPage.errors.cannotSaveWithoutCollaborators')
        return
      }

      editingPolicyText = false
      await reload()
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  async function applyMovePolicy(grantId: string, targetPolicyId: string): Promise<void> {
    busy = true
    loadError = null
    try {
      if (!(await patchGrantToPolicyTarget(grantId, targetPolicyId))) {
        loadError = $t('access.policyDetailPage.errors.updateFailed', { status: 500 })
        return
      }
      await reload()
      const updated = grantedByMe.find((g) => g.id === grantId)
      const nextBucket = updated ? classifyGrantPolicy(updated, customPolicies).policyId : targetPolicyId
      changeGrantId = null
      if (nextBucket !== props.policyId) {
        props.onSettingsNavigate({ type: 'brain-access-policy', policyId: nextBucket }, { replace: true })
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  const excludeHandles = $derived(
    new Set(
      grantsInPolicy
        .map((g) => (g.askerHandle ?? '').toLowerCase())
        .filter((h) => h.length > 0),
    ),
  )

  const heading = $derived(card?.label ?? $t('access.policyDetailPage.fallbackPolicyLabel'))
  const hint = $derived(card?.hint)

  const isCustomPolicyId = $derived(
    props.policyId.startsWith('bqc_') || props.policyId.startsWith('custom:'),
  )
  const canDeleteCustomPreset = $derived(isCustomPolicyId && grantsInPolicy.length === 0)

  function requestDeleteCustomPreset() {
    if (!canDeleteCustomPreset || busy) return
    pendingDeletePreset = { label: heading }
  }

  function cancelDeleteCustomPreset() {
    pendingDeletePreset = null
  }

  async function confirmDeleteCustomPreset(): Promise<void> {
    if (!pendingDeletePreset) return
    if (props.policyId.startsWith('bqc_')) {
      busy = true
      try {
        const res = await fetch(`/api/brain-query/policies/${encodeURIComponent(props.policyId)}`, {
          method: 'DELETE',
        })
        if (!res.ok) return
        pendingDeletePreset = null
        props.onBackToBrainAccessList()
      } finally {
        busy = false
      }
      return
    }
    if (!props.policyId.startsWith('custom:')) return
    const ok = removeBrainAccessCustomPolicy(props.policyId)
    pendingDeletePreset = null
    if (ok) props.onBackToBrainAccessList()
  }
</script>

<div class="policy-detail-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-foreground">
  <PaneL2Header>
    {#snippet center()}
      <div class="flex min-h-0 min-w-0 flex-1 items-center">
        <BrainAccessBreadcrumbs
          variant="policy"
          policyLabel={heading}
          onGoToList={() => props.onBackToBrainAccessList()}
          onGoToSettings={() => props.onNavigateToSettingsRoot()}
        />
      </div>
    {/snippet}
  </PaneL2Header>

  <div class="policy-detail-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
    <div class="policy-detail-inner mx-auto flex w-full max-w-[900px] flex-col gap-6 px-8 pb-6 pt-4 max-md:px-4 max-md:pb-4">
      {#if loadError}
        <p class="m-0 text-[0.875rem] text-red-600 dark:text-red-400" role="alert">{loadError}</p>
      {/if}

      {#if !card && grantsInPolicy.length === 0 && !busy}
    <p class="m-0 text-[0.875rem] text-muted">{$t('access.policyDetailPage.policyNotFound')}</p>
  {:else}
    <header
      class={[
        'flex flex-col gap-2 rounded-lg border-l-4 p-4',
        tone.bar,
        tone.ring,
        tone.softBg,
      ]}
    >
      <h1 class="m-0 text-[1.35rem] font-extrabold tracking-tight text-foreground">{heading}</h1>
      {#if hint}
        <p class="m-0 text-[0.875rem] text-muted">{hint}</p>
      {/if}
    </header>

    <BrainQueryPolicyBaselineNote />

    <section class="flex flex-col gap-2" aria-labelledby="policy-text-heading">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="policy-text-heading" class="m-0 text-[0.8125rem] font-bold uppercase tracking-wide text-muted">
          {$t('access.policyDetailPage.policyTextHeading')}
        </h2>
        {#if !editingPolicyText}
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-2 py-1 text-[0.75rem] font-semibold hover:bg-surface-2 disabled:opacity-50"
              disabled={busy}
              onclick={() => {
                draftPolicyText = canonical
                editingPolicyText = true
              }}
            >
              {$t('access.policyDetailPage.actions.edit')}
            </button>
            {#if isCustomPolicyId}
              <button
                type="button"
                class="rounded-md border border-[color-mix(in_srgb,var(--danger)_45%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_10%,var(--bg))] px-2 py-1 text-[0.75rem] font-semibold text-danger hover:bg-[color-mix(in_srgb,var(--danger)_18%,var(--bg))] disabled:opacity-50"
                disabled={busy || !canDeleteCustomPreset}
                title={grantsInPolicy.length > 0 ? $t('access.policyDetailPage.tooltips.removeCollaboratorsFirst') : undefined}
                aria-label={grantsInPolicy.length > 0
                  ? $t('access.policyDetailPage.ariaDeletePolicyRemoveCollaboratorsFirst')
                  : $t('access.policyDetailPage.ariaDeletePolicy')}
                onclick={requestDeleteCustomPreset}
              >
                {$t('access.policyDetailPage.actions.deletePolicy')}
              </button>
            {/if}
          </div>
        {:else}
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-2 py-1 text-[0.75rem] font-semibold hover:bg-surface-2 disabled:opacity-50"
              disabled={busy}
              onclick={() => {
                if (!busy) editingPolicyText = false
              }}
            >
              {$t('common.actions.cancel')}
            </button>
            <button
              type="button"
              class="rounded-md border border-transparent bg-accent px-2 py-1 text-[0.75rem] font-semibold text-white hover:brightness-105 disabled:opacity-50"
              disabled={busy || draftPolicyText.trim().length === 0}
              onclick={() => void saveAllPolicyText(draftPolicyText.trim())}
            >
              {busy ? $t('common.status.saving') : $t('access.policyDetailPage.actions.savePolicy')}
            </button>
          </div>
        {/if}
      </div>
      {#if !editingPolicyText}
        <div
          class="rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface p-3 text-[0.8125rem] leading-relaxed whitespace-pre-wrap text-foreground"
        >
          {canonical || $t('access.policyDetailPage.emptyPolicyText')}
        </div>
      {:else}
        <div
          class="rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface p-3 text-[0.8125rem] leading-relaxed text-foreground"
        >
          <p class="m-0 text-[0.8125rem] text-muted">
            {$t('access.policyDetailPage.editGuidance')}
          </p>
          <label class="mt-2 flex flex-col gap-1">
            <span class="text-[0.6875rem] font-bold uppercase tracking-wide text-muted">
              {$t('access.policyDetailPage.privacyGuidanceLabel')}
            </span>
            <textarea
              id="policy-text-draft"
              class="min-h-[12rem] w-full rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface p-2 text-[0.8125rem] leading-snug text-foreground"
              aria-labelledby="policy-text-heading"
              bind:value={draftPolicyText}
              disabled={busy}
            ></textarea>
          </label>
        </div>
      {/if}
    </section>

    <section class="flex flex-col gap-3" aria-labelledby="policy-users-heading">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="policy-users-heading" class="m-0 text-[0.9375rem] font-bold">
          {$t('access.policyDetailPage.collaboratorsHeading', { count: grantsInPolicy.length })}
        </h2>
        <AddUserDropdown
          excludeHandles={excludeHandles}
          disabled={!canonical || busy}
          busy={addBusy}
          onPick={(e) => void addUser(e)}
        />
      </div>
      {#each grantsInPolicy as grant (grant.id)}
        {@const h = (grant.askerHandle ?? '').toLowerCase()}
        {@const prof = h ? profileByHandle[h] : undefined}
        <UserDetailRow
          {grant}
          displayName={prof?.displayName}
          email={prof?.email}
          removeBusy={removeBusyId === grant.id}
          autoSendBusy={autoSendBusyId === grant.id}
          onRemove={() => void removeGrant(grant.id)}
          onAutoSendChange={(next) => void patchGrantAutoSend(grant.id, next)}
          onChangePolicy={() => {
            changeGrantId = grant.id
          }}
        />
      {/each}
    </section>

  {/if}

  <button
    type="button"
    class="self-start rounded-md border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-3 px-3 py-1.5 text-[0.8125rem] font-semibold hover:bg-surface-2"
    disabled={busy}
    onclick={() => void reload()}
  >
    {$t('common.actions.refresh')}
  </button>
    </div>
  </div>
</div>

<ChangePolicyDialog
  open={changeGrantId !== null}
  grantId={changeGrantId}
  customPolicies={customPolicies}
  excludePolicyId={props.policyId}
  onDismiss={() => {
    changeGrantId = null
  }}
  onApply={(grantId, targetPolicyId) => applyMovePolicy(grantId, targetPolicyId)}
/>

<ConfirmDialog
  open={pendingDeletePreset !== null}
  title={$t('access.policyDetailPage.deletePolicyDialog.title')}
  titleId="brain-access-policy-delete-title"
  confirmLabel={$t('access.policyDetailPage.deletePolicyDialog.confirmLabel')}
  cancelLabel={$t('common.actions.cancel')}
  confirmVariant="danger"
  onDismiss={cancelDeleteCustomPreset}
  onConfirm={() => void confirmDeleteCustomPreset()}
>
  {#snippet children()}
    {#if pendingDeletePreset}
      <p>{$t('access.policyDetailPage.deletePolicyDialog.body', { label: pendingDeletePreset.label })}</p>
    {/if}
  {/snippet}
</ConfirmDialog>
