<script lang="ts">
  type Props = {
    initialId?: string
    targetId?: string
    onNavigate?: (_id?: string) => void
    onContextChange?: (_ctx: unknown) => void
    onOpenSearch?: () => void
    onSummarizeInbox?: (_msg: string) => void
  }
  let { initialId }: Props = $props()
</script>

<div data-testid="inbox-stub">Inbox: {initialId ?? 'list'}</div>
