<script lang="ts">
  import type { NavigateOptions, Overlay } from '@client/router.js'
  import SettingsSubpageHeader from '@components/settings/SettingsSubpageHeader.svelte'
  import SettingsConnectionsList from '@components/settings/SettingsConnectionsList.svelte'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    selectedHubSourceId?: string
    onNavigateToSettingsRoot: () => void
  }

  let { onSettingsNavigate, selectedHubSourceId, onNavigateToSettingsRoot }: Props = $props()
</script>

<div class="settings-connections-shell flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-foreground">
  <SettingsSubpageHeader
    pageTitle={$t('settings.settingsConnectionsPage.title')}
    onNavigateToSettingsRoot={onNavigateToSettingsRoot}
  />

  <div class="settings-connections-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
    <div class="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-8 py-8 pb-10 max-md:px-4 max-md:py-6">
      <SettingsConnectionsList {onSettingsNavigate} {selectedHubSourceId} />
    </div>
  </div>
</div>
