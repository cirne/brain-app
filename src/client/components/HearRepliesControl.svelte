<script lang="ts">
  import { ensureBrainTtsAutoplayInUserGesture } from '@client/lib/brainTtsAudio.js'
  import { requestMicrophonePermissionInUserGesture } from '@client/lib/holdToSpeakMedia.js'

  let {
    hearReplies = false,
    onHearRepliesChange,
  }: {
    hearReplies?: boolean
    onHearRepliesChange?: (_value: boolean) => void
  } = $props()

  function toggleHearReplies(checked: boolean) {
    onHearRepliesChange?.(checked)
    if (checked) {
      void ensureBrainTtsAutoplayInUserGesture()
      void requestMicrophonePermissionInUserGesture()
    }
  }
</script>

<div class="hear-replies-row">
  <label class="hear-replies-control">
    <span class="hear-replies-title">Audio Conversation</span>
    <span class="hear-replies-switch">
      <input
        type="checkbox"
        class="hear-replies-input"
        checked={hearReplies}
        onchange={(e) => toggleHearReplies((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="hear-replies-track" aria-hidden="true">
        <span class="hear-replies-thumb"></span>
      </span>
    </span>
  </label>
</div>

<style>
  .hear-replies-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: 20rem;
    width: 100%;
    margin-inline: auto;
    text-align: center;
  }
  .hear-replies-control {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: 100%;
    max-width: 17.5rem;
    padding: 0.125rem 0;
    user-select: none;
    cursor: pointer;
  }
  .hear-replies-title {
    color: var(--text);
    font-weight: 500;
    text-align: start;
    flex: 1;
    min-width: 0;
  }
  .hear-replies-switch {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
  }
  .hear-replies-input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
    opacity: 0;
  }
  .hear-replies-input:focus-visible + .hear-replies-track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .hear-replies-track {
    position: relative;
    width: 3.125rem;
    height: 1.875rem;
    border-radius: 100px;
    background: color-mix(in srgb, var(--text) 20%, var(--bg-2));
    transition: background 0.2s ease;
  }
  .hear-replies-input:checked + .hear-replies-track {
    background: #34c759;
  }
  @media (prefers-color-scheme: dark) {
    .hear-replies-input:checked + .hear-replies-track {
      background: #30d158;
    }
  }
  .hear-replies-thumb {
    position: absolute;
    top: 0.125rem;
    left: 0.125rem;
    width: 1.625rem;
    height: 1.625rem;
    border-radius: 50%;
    background: #fff;
    box-shadow:
      0 0.125rem 0.25rem rgba(0, 0, 0, 0.12),
      0 0.125rem 0.0625rem rgba(0, 0, 0, 0.08);
    transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .hear-replies-input:checked + .hear-replies-track .hear-replies-thumb {
    transform: translateX(1.25rem);
  }
</style>
