<script lang="ts">
  import FullDiskAccessGate from '../onboarding/FullDiskAccessGate.svelte'
</script>

<FullDiskAccessGate>
  {#snippet children()}
    <p data-testid="fda-child">Gated app surface</p>
  {/snippet}
</FullDiskAccessGate>
