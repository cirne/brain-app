<script lang="ts">
  type Props = {
    initialChat?: string
    onContextChange?: (_ctx: unknown) => void
  }
  let { initialChat }: Props = $props()
</script>

<div data-testid="messages-stub">Messages: {initialChat ?? 'none'}</div>
