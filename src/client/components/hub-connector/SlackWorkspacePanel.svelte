<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { emit } from '@client/lib/app/appEvents.js'
  import { getHubSourceSlideHeaderCell } from '@client/lib/hubSourceSlideHeaderContext.js'
  import SettingsSectionH2 from '@components/settings/SettingsSectionH2.svelte'
  import ConfirmDialog from '@components/ConfirmDialog.svelte'
  import SegmentedControl from '@components/SegmentedControl.svelte'
  import type { SegmentedOption } from '@client/lib/segmentedControl.js'
  import PolicyCard from '@components/brain-access/PolicyCard.svelte'
  import { t } from '@client/lib/i18n/index.js'
  import { fetchBrainQueryBuiltinPolicyBodies } from '@client/lib/brainQueryBuiltinPolicyBodiesApi.js'
  import {
    buildPolicyPickerOptions,
    policyPickerOptionToCardModel,
    type PolicyPickerOption,
  } from '@client/lib/brainAccessPolicyGrouping.js'
  import {
    fetchBrainAccessCustomPoliciesFromServer,
    mergeServerAndLegacyCustomPolicies,
  } from '@client/lib/brainAccessCustomPolicies.js'
  import { cn } from '@client/lib/cn.js'

  type Props = {
    teamId: string | undefined
    onClose: () => void
  }

  let { teamId, onClose }: Props = $props()

  type SlackWorkspaceStatus = {
    slackTeamId: string
    teamName: string
    workspaceConnected: boolean
    userLinked: boolean
    slackUserId: string | null
  }

  let loadError = $state<string | null>(null)
  let settingsForbidden = $state(false)
  let teamNameResolved = $state<string | null>(null)
  let autorespond = $state(false)
  let inboundPolicyId = $state('general')
  let policyOptions = $state<PolicyPickerOption[]>([])
  let loadingSettings = $state(true)
  let saving = $state(false)
  let saveError = $state<string | null>(null)
  let disconnectBusy = $state(false)
  let autorespondConfirmOpen = $state(false)
  /** Persisted reply mode (review vs autosend). */
  let replyDraft = $state<'review' | 'auto'>('review')
  let replyUiBind = $state<'review' | 'auto'>('review')

  const hubSourceHeaderCell = getHubSourceSlideHeaderCell()
  let hubSourceHeaderCtrl: ReturnType<NonNullable<typeof hubSourceHeaderCell>['claim']> | null = null

  const displayTitle = $derived(
    teamNameResolved?.trim() || teamId?.trim() || $t('settings.settingsConnectionsPage.slack.panelTitleFallback'),
  )

  const replyControlDisabled = $derived(saving || disconnectBusy)

  const replySegmentOptions = $derived.by(
    (): SegmentedOption<'review' | 'auto'>[] => [
      {
        value: 'review',
        label: $t('chat.review.detail.policy.segment.review'),
        testId: 'slack-reply-review',
      },
      {
        value: 'auto',
        label: $t('chat.review.detail.policy.segment.auto'),
        testId: 'slack-reply-auto',
      },
    ],
  )

  const replyHintText = $derived(
    replyUiBind === 'auto'
      ? $t('chat.tunnels.connection.replyHint.auto')
      : $t('chat.tunnels.connection.replyHint.review'),
  )

  async function loadPolicyCatalog(): Promise<PolicyPickerOption[]> {
    const [bodies, remoteCustom] = await Promise.all([
      fetchBrainQueryBuiltinPolicyBodies(),
      fetchBrainAccessCustomPoliciesFromServer(),
    ])
    const customPolicies = mergeServerAndLegacyCustomPolicies(remoteCustom)
    return buildPolicyPickerOptions(customPolicies, bodies)
  }

  async function reloadAll() {
    const tid = teamId?.trim()
    if (!tid) {
      loadError = $t('settings.settingsConnectionsPage.slack.panelLoadError')
      loadingSettings = false
      return
    }
    loadError = null
    settingsForbidden = false
    loadingSettings = true
    try {
      const [connRes, setRes, options] = await Promise.all([
        fetch('/api/slack/connection'),
        fetch(`/api/slack/connection/${encodeURIComponent(tid)}/settings`),
        loadPolicyCatalog(),
      ])
      policyOptions = options
      if (connRes.ok) {
        const j = (await connRes.json()) as { workspaces?: SlackWorkspaceStatus[] }
        const w = Array.isArray(j.workspaces) ? j.workspaces.find((x) => x.slackTeamId === tid) : undefined
        teamNameResolved = w?.teamName?.trim() || null
      }
      if (!setRes.ok) {
        if (setRes.status === 403) {
          settingsForbidden = true
        } else {
          loadError = $t('settings.settingsConnectionsPage.slack.panelLoadError')
        }
        loadingSettings = false
        return
      }
      const s = (await setRes.json()) as {
        ok?: boolean
        autorespond?: boolean
        inboundPolicy?: string
      }
      if (!s.ok) {
        loadError = $t('settings.settingsConnectionsPage.slack.panelLoadError')
      } else {
        saveError = null
        autorespond = s.autorespond === true
        replyDraft = autorespond ? 'auto' : 'review'
        replyUiBind = replyDraft
        const saved = typeof s.inboundPolicy === 'string' ? s.inboundPolicy.trim() : ''
        inboundPolicyId =
          options.some((o) => o.policyId === saved) ? saved : (options[0]?.policyId ?? 'general')
      }
    } catch {
      loadError = $t('settings.settingsConnectionsPage.slack.panelLoadError')
    } finally {
      loadingSettings = false
    }
  }

  async function patchSettings(partial: { autorespond?: boolean; inboundPolicy?: string }) {
    const tid = teamId?.trim()
    if (!tid || settingsForbidden) return
    saving = true
    saveError = null
    try {
      const res = await fetch(`/api/slack/connection/${encodeURIComponent(tid)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      })
      if (!res.ok) {
        saveError = $t('settings.settingsConnectionsPage.slack.savingError')
        return
      }
      const s = (await res.json()) as {
        ok?: boolean
        autorespond?: boolean
        inboundPolicy?: string
      }
      if (s.ok !== true) {
        saveError = $t('settings.settingsConnectionsPage.slack.savingError')
        return
      }
      autorespond = s.autorespond === true
      replyDraft = autorespond ? 'auto' : 'review'
      replyUiBind = replyDraft
      const saved = typeof s.inboundPolicy === 'string' ? s.inboundPolicy.trim() : ''
      if (policyOptions.some((o) => o.policyId === saved)) {
        inboundPolicyId = saved
      }
    } catch {
      saveError = $t('settings.settingsConnectionsPage.slack.savingError')
    } finally {
      saving = false
    }
  }

  async function onReplySegmentChange(next: 'review' | 'auto'): Promise<void> {
    if (replyControlDisabled) return
    if (next === replyDraft) {
      replyUiBind = replyDraft
      return
    }

    if (next === 'auto') {
      autorespondConfirmOpen = true
      replyUiBind = replyDraft
      return
    }

    replyUiBind = 'review'
    await patchSettings({ autorespond: false })
  }

  function confirmAutorespond() {
    autorespondConfirmOpen = false
    replyUiBind = 'auto'
    void patchSettings({ autorespond: true })
  }

  function dismissAutorespondConfirm() {
    autorespondConfirmOpen = false
    replyUiBind = replyDraft
  }

  async function onPolicyPick(policyId: string) {
    if (policyId === inboundPolicyId) return
    await patchSettings({ inboundPolicy: policyId })
  }

  async function disconnectSlack() {
    const tid = teamId?.trim()
    if (!tid || disconnectBusy) return
    disconnectBusy = true
    try {
      await fetch('/api/slack/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slackTeamId: tid }),
      })
      emit({ type: 'slack:connections-changed' })
      onClose()
    } finally {
      disconnectBusy = false
    }
  }

  const btnDangerLink =
    'm-0 cursor-pointer border-0 bg-transparent p-0 text-[0.8125rem] font-semibold text-danger underline decoration-[color-mix(in_srgb,var(--danger)_55%,transparent)] underline-offset-2 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

  /** Stable ref for hub slide header refresh (BUG: changing lambda each tick → effect_update_depth_exceeded). */
  function hubSlideRefresh() {
    void reloadAll()
  }

  $effect(() => {
    const tid = teamId?.trim()
    if (!tid) return
    untrack(() => {
      void reloadAll()
    })
  })

  const headerBusy = $derived(loadingSettings || saving || disconnectBusy)

  $effect(() => {
    if (!hubSourceHeaderCell) return
    const next = {
      title: displayTitle,
      onRefresh: hubSlideRefresh,
      refreshDisabled: headerBusy || !teamId?.trim(),
      refreshSpinning: loadingSettings || saving,
      refreshAriaLabel: $t('nav.hub.refreshIndex'),
    }
    if (!hubSourceHeaderCtrl?.isOwner) {
      hubSourceHeaderCtrl = hubSourceHeaderCell.claim(next)
    } else {
      hubSourceHeaderCtrl.patch(next)
    }
  })

  onDestroy(() => {
    hubSourceHeaderCtrl?.clear()
    hubSourceHeaderCtrl = null
  })
</script>

<div class="slack-workspace-panel min-h-0 flex-1 overflow-auto px-5 pb-6 pt-4">
  {#if !teamId?.trim()}
    <p class="m-0 text-[0.9375rem] leading-[1.45] text-danger" role="alert">
      {$t('settings.settingsConnectionsPage.slack.panelLoadError')}
    </p>
  {:else if settingsForbidden}
    <p class="m-0 text-[0.9375rem] leading-[1.45] text-muted" role="alert">
      {$t('settings.settingsConnectionsPage.slack.panelForbidden')}
    </p>
  {:else if loadError}
    <p class="m-0 text-[0.9375rem] leading-[1.45] text-danger" role="alert">{loadError}</p>
  {:else}
    <div class="flex flex-col gap-6">
      <section class="flex flex-col gap-3" aria-labelledby="slack-replies-h2">
        <SettingsSectionH2
          id="slack-replies-h2"
          label={$t('chat.tunnels.connection.repliesHeading')}
        />
        <SegmentedControl
          class="w-full max-w-[14rem] shrink-0"
          options={replySegmentOptions}
          bind:value={replyUiBind}
          groupLabel={$t('chat.review.detail.policy.groupLabel')}
          disabled={replyControlDisabled || loadingSettings}
          onValueChange={(next) => void onReplySegmentChange(next)}
        />
        <div
          aria-live="polite"
          class={cn(
            replyUiBind === 'auto' &&
              'rounded-md border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,var(--surface-2))] px-3 py-2.5',
          )}
        >
          <p
            class={cn(
              'm-0 text-[0.8125rem] leading-snug',
              replyUiBind === 'auto' ? 'text-danger' : 'text-muted',
            )}
          >
            {replyHintText}
          </p>
        </div>
      </section>

      <section class="flex flex-col gap-3" aria-labelledby="slack-policy-h2">
        <div class="flex flex-col gap-1">
          <SettingsSectionH2 id="slack-policy-h2" label={$t('settings.settingsConnectionsPage.slack.inboundPolicy')} />
          <p class="m-0 text-[0.8125rem] leading-[1.4] text-muted">
            {$t('settings.settingsConnectionsPage.slack.inboundPolicyHint')}
          </p>
        </div>
        <fieldset disabled={loadingSettings || saving || disconnectBusy} class="m-0 flex flex-col gap-3 border-none p-0">
          {#each policyOptions as opt (opt.policyId)}
            <PolicyCard
              variant="select"
              model={policyPickerOptionToCardModel(opt)}
              radioName="slack-inbound"
              selected={inboundPolicyId === opt.policyId}
              disabled={loadingSettings || saving || disconnectBusy}
              onSelect={(id) => void onPolicyPick(id)}
            />
          {/each}
        </fieldset>
      </section>

      {#if saveError}
        <p class="m-0 text-[0.875rem] text-destructive" role="alert">{saveError}</p>
      {/if}
      {#if saving}
        <p class="m-0 text-[0.8125rem] text-muted" aria-live="polite">{$t('settings.settingsConnectionsPage.slack.saving')}</p>
      {/if}

      <section class="flex flex-col gap-2 border-t border-border pt-4">
        <button
          type="button"
          class={btnDangerLink}
          disabled={disconnectBusy || loadingSettings}
          onclick={() => void disconnectSlack()}
        >
          {$t('settings.settingsConnectionsPage.slack.disconnect')}
        </button>
      </section>
    </div>
  {/if}
</div>

<ConfirmDialog
  open={autorespondConfirmOpen}
  title={$t('settings.settingsConnectionsPage.slack.autorespondConfirm.title')}
  titleId="slack-autorespond-confirm-title"
  confirmLabel={$t('chat.review.detail.policy.autoSendConfirm.confirm')}
  onDismiss={dismissAutorespondConfirm}
  onConfirm={confirmAutorespond}
>
  <p>{$t('chat.review.detail.policy.autoSendConfirm.body1')}</p>
  <p>{$t('chat.review.detail.policy.autoSendConfirm.body2')}</p>
</ConfirmDialog>
