<script lang="ts">
  import { emit } from '@client/lib/app/appEvents.js'
  import { onMount } from 'svelte'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    /** After successful Slack link-from-OAuth confirmation, refetch Slack rows upstream. */
    onSlackLinkConfirmed?: () => void | Promise<void>
  }

  let { onSlackLinkConfirmed }: Props = $props()

  let linkConfirmPending = $state(false)
  let confirmEmail = $state('')
  let confirmState = $state('')
  let confirmTeamId = $state('')
  let confirmSlackUserId = $state('')
  let confirmError = $state('')
  let confirmLoading = $state(false)

  async function notifySlackChanged() {
    emit({ type: 'slack:connections-changed' })
    await onSlackLinkConfirmed?.()
  }

  function checkLinkConfirmParams() {
    const params = new URLSearchParams(window.location.search)
    if (params.get('slackLinkConfirm') === '1') {
      confirmEmail = params.get('slackEmail') ?? ''
      confirmTeamId = params.get('slackTeamId') ?? ''
      confirmSlackUserId = params.get('slackUserId') ?? ''
      confirmState = params.get('confirmState') ?? ''
      linkConfirmPending = true
    }
  }

  async function submitLinkConfirm() {
    confirmLoading = true
    confirmError = ''
    try {
      const res = await fetch('/api/slack/oauth/link-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmState,
          slackTeamId: confirmTeamId,
          slackUserId: confirmSlackUserId,
        }),
      })
      if (!res.ok) {
        confirmError = $t('settings.settingsConnectionsPage.slack.linkConfirmError')
        return
      }
      linkConfirmPending = false
      window.history.replaceState({}, '', '/settings')
      await notifySlackChanged()
    } catch {
      confirmError = $t('settings.settingsConnectionsPage.slack.linkConfirmError')
    } finally {
      confirmLoading = false
    }
  }

  function cancelLinkConfirm() {
    linkConfirmPending = false
    confirmEmail = ''
    confirmState = ''
    confirmTeamId = ''
    confirmSlackUserId = ''
    confirmError = ''
    window.history.replaceState({}, '', '/settings')
  }

  onMount(() => {
    checkLinkConfirmParams()
  })
</script>

{#if linkConfirmPending}
  <div
    class="settings-slack-link-confirm mb-4 flex flex-col gap-2 rounded border border-[color-mix(in_srgb,var(--border)_60%,transparent)] p-3 text-[0.9375rem]"
  >
    <p class="m-0">
      {$t('settings.settingsConnectionsPage.slack.linkConfirmBody', { slackEmail: confirmEmail })}
    </p>
    {#if confirmError}
      <p class="m-0 text-sm text-destructive">{confirmError}</p>
    {/if}
    <div class="flex gap-2">
      <button
        type="button"
        class="btn btn-primary text-sm"
        disabled={confirmLoading}
        onclick={submitLinkConfirm}
      >
        {$t('settings.settingsConnectionsPage.slack.linkConfirmButton')}
      </button>
      <button
        type="button"
        class="btn btn-secondary text-sm"
        disabled={confirmLoading}
        onclick={cancelLinkConfirm}
      >
        {$t('settings.settingsConnectionsPage.slack.linkConfirmCancel')}
      </button>
    </div>
  </div>
{/if}
