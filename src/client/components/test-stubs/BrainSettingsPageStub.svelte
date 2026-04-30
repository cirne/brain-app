<script lang="ts">
  import type { Overlay, NavigateOptions } from '@client/router.js'

  let {
    onSettingsNavigate: _onSettingsNavigate = () => {},
  }: {
    onSettingsNavigate?: (_overlay: Overlay, _opts?: NavigateOptions) => void
  } = $props()
</script>

<div data-testid="brain-settings-page-stub" class="brain-settings-page-stub">BrainSettingsPage</div>
