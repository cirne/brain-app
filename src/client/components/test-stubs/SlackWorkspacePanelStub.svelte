<script lang="ts">
  let { teamId }: { teamId?: string } = $props()
</script>

<div data-testid="slack-workspace-stub">SlackWorkspace: {teamId ?? 'none'}</div>
