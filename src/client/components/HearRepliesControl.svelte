<script lang="ts">
  import { ensureBrainTtsAutoplayInUserGesture } from '@client/lib/brainTtsAudio.js'
  import { t } from '@client/lib/i18n/index.js'

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
    }
  }
</script>

<div class="hear-replies-row mx-auto flex w-full max-w-[20rem] flex-col items-center text-center">
  <label
    class="hear-replies-control flex w-full max-w-[17.5rem] cursor-pointer select-none flex-row items-center justify-between gap-3 py-0.5"
  >
    <span class="hear-replies-title min-w-0 flex-1 text-start font-medium text-foreground">{$t('chat.agentChat.audioConversation')}</span>
    <span class="hear-replies-switch relative inline-flex shrink-0 [-webkit-tap-highlight-color:transparent]">
      <input
        type="checkbox"
        class="hear-replies-input absolute m-[-1px] h-px w-px overflow-hidden whitespace-nowrap border-0 p-0 opacity-0 [clip:rect(0,0,0,0)]"
        checked={hearReplies}
        onchange={(e) => toggleHearReplies((e.currentTarget as HTMLInputElement).checked)}
      />
      <span
        class="hear-replies-track relative h-[1.875rem] w-[3.125rem] bg-[color-mix(in_srgb,var(--text)_20%,var(--bg-2))] transition-[background] duration-200"
        aria-hidden="true"
      >
        <span class="hear-replies-thumb absolute left-0.5 top-0.5 h-[1.625rem] w-[1.625rem] bg-white [box-shadow:0_0.125rem_0.25rem_rgba(0,0,0,0.12),0_0.125rem_0.0625rem_rgba(0,0,0,0.08)] [transition:transform_0.22s_cubic-bezier(0.4,0,0.2,1)]"></span>
      </span>
    </span>
  </label>
</div>

<style>
  /* Sibling-state styling cannot be expressed with Tailwind utilities on a sibling. */
  .hear-replies-input:focus-visible + .hear-replies-track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .hear-replies-input:checked + .hear-replies-track {
    background: #34c759;
  }
  @media (prefers-color-scheme: dark) {
    .hear-replies-input:checked + .hear-replies-track {
      background: #30d158;
    }
  }
  .hear-replies-input:checked + .hear-replies-track .hear-replies-thumb {
    transform: translateX(1.25rem);
  }
</style>
