<script lang="ts">
  type Props = {
    accountEmail?: string
    onClose?: () => void
  }
  let { accountEmail }: Props = $props()
</script>

<div data-testid="google-account-stub">GoogleAccount: {accountEmail ?? 'none'}</div>
