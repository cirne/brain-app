<script lang="ts">
  import AppShell from '@components/app/AppShell.svelte'

  let { stackTopNavFirst = false }: { stackTopNavFirst?: boolean } = $props()
</script>

<AppShell {stackTopNavFirst}>
  {#snippet topNav()}
    <div data-testid="shell-top-nav">nav</div>
  {/snippet}
  {#snippet sidebar()}
    <div data-testid="shell-sidebar">sidebar</div>
  {/snippet}
  {#snippet workspace()}
    <div data-testid="shell-workspace">workspace</div>
  {/snippet}
</AppShell>
