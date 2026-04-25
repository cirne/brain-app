<script lang="ts">
  import { onMount } from 'svelte'
  import AgentHoldToSpeak from './AgentHoldToSpeak.svelte'
  import HearRepliesControl from './HearRepliesControl.svelte'

  let {
    disabled = false,
    /** When false, hide the hear-replies toggle (e.g. header shows it once there are messages). */
    showHearRepliesToggle = true,
    hearReplies = false,
    onHearRepliesChange,
    onTranscribe,
  }: {
    disabled?: boolean
    showHearRepliesToggle?: boolean
    hearReplies?: boolean
    onHearRepliesChange: (_value: boolean) => void
    onTranscribe: (_text: string) => void
  } = $props()

  let isMobile = $state(false)

  onMount(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => {
      isMobile = mq.matches
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  })
</script>

{#if isMobile}
  <div class="chat-composer-audio">
    {#if showHearRepliesToggle}
      <HearRepliesControl {hearReplies} {onHearRepliesChange} />
    {/if}
    <div
      class="hold-speak-wrap"
      class:hold-speak-wrap--gated={!hearReplies}
      aria-hidden={!hearReplies}
    >
      <AgentHoldToSpeak {disabled} {hearReplies} {onTranscribe} holdGated={!hearReplies} />
    </div>
  </div>
{/if}

<style>
  .chat-composer-audio {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    margin-top: 16px;
    padding: 0 12px 10px;
    flex-shrink: 0;
  }

  .hold-speak-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
  }

  /* Space reserved: same box as when visible; only paint/interaction are suppressed. */
  .hold-speak-wrap--gated {
    visibility: hidden;
    pointer-events: none;
    user-select: none;
  }
</style>
