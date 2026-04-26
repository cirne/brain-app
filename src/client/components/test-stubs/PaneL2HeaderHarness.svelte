<script lang="ts">
  import PaneL2Header from '../PaneL2Header.svelte'
</script>

<PaneL2Header>
  {#snippet left()}
    <span data-testid="pane-left">Left</span>
  {/snippet}
  {#snippet center()}
    <span data-testid="pane-center">Center</span>
  {/snippet}
  {#snippet right()}
    <span data-testid="pane-right">Right</span>
  {/snippet}
</PaneL2Header>
