<script lang="ts">
  let {
    showHearRepliesToggle: _show = true,
    hearReplies: _hear = false,
    onHearRepliesChange: _onHearRepliesChange = () => {},
  }: {
    showHearRepliesToggle?: boolean
    hearReplies?: boolean
    onHearRepliesChange?: (_value: boolean) => void
  } = $props()
</script>

<div data-testid="chat-composer-audio-stub" aria-hidden="true"></div>
