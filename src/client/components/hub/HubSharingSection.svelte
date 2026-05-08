<script lang="ts">
  import HubBrainAccessSummary from './HubBrainAccessSummary.svelte'

  type Props = {
    onManageBrainAccess: () => void
  }

  let { onManageBrainAccess }: Props = $props()
</script>

<HubBrainAccessSummary onManageAccess={onManageBrainAccess} />
