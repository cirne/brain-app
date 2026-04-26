<script lang="ts">
  import HubSourceRowBody from '../HubSourceRowBody.svelte'
  import { Folder } from 'lucide-svelte'
</script>

<HubSourceRowBody title="Documents" subtitle="~/Library/Mail">
  {#snippet icon()}
    <Folder size={14} aria-hidden="true" />
  {/snippet}
</HubSourceRowBody>
