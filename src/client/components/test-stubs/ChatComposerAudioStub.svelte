<script lang="ts">
  let {
    disabled: _disabled = false,
    showHearRepliesToggle: _show = true,
    hearReplies: _hear = false,
    draftHidesHold: _draft = false,
    onHearRepliesChange: _onHearRepliesChange = () => {},
    onTranscribe: _onTranscribe = () => {},
  }: {
    disabled?: boolean
    showHearRepliesToggle?: boolean
    hearReplies?: boolean
    draftHidesHold?: boolean
    onHearRepliesChange?: (_value: boolean) => void
    onTranscribe?: (_text: string) => void
  } = $props()
</script>

<div data-testid="chat-composer-audio-stub" aria-hidden="true"></div>
