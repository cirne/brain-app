<script lang="ts">
  type Props = {
    sourceId?: string
    onClose?: () => void
  }
  let { sourceId }: Props = $props()
</script>

<div data-testid="hub-source-stub">HubSourceInspect: {sourceId ?? 'none'}</div>
