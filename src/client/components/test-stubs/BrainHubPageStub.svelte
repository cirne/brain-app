<script lang="ts">
  import type { Overlay, NavigateOptions } from '@client/router.js'

  let {
    onHubNavigate: _onHubNavigate = () => {},
  }: {
    onHubNavigate?: (_overlay: Overlay, _opts?: NavigateOptions) => void
  } = $props()
</script>

<div data-testid="brain-hub-page-stub" class="brain-hub-page-stub">BrainHubPage</div>
