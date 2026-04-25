<script lang="ts">
  import { onMount } from 'svelte'
  import { isPressToTalkEnabled } from '@client/lib/pressToTalkEnabled.js'
  import AgentHoldToSpeak from './AgentHoldToSpeak.svelte'
  import HearRepliesControl from './HearRepliesControl.svelte'

  const pressToTalkUiEnabled = isPressToTalkEnabled()

  let {
    disabled = false,
    /** When false, hide the hear-replies toggle (e.g. header shows it once there are messages). */
    showHearRepliesToggle = true,
    hearReplies = false,
    /** When true, the hold-to-speak control slides away so the text field and history use the space. */
    draftHidesHold = false,
    onHearRepliesChange,
    onTranscribe,
  }: {
    disabled?: boolean
    showHearRepliesToggle?: boolean
    hearReplies?: boolean
    draftHidesHold?: boolean
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

{#if isMobile && (showHearRepliesToggle || pressToTalkUiEnabled)}
  <div
    class="chat-composer-audio"
    class:chat-composer-audio--hold-slid={draftHidesHold && pressToTalkUiEnabled}
  >
    {#if showHearRepliesToggle}
      <HearRepliesControl {hearReplies} {onHearRepliesChange} />
    {/if}
    {#if pressToTalkUiEnabled}
      <div
        class="hold-speak-wrap"
        class:hold-speak-wrap--gated={!hearReplies && !draftHidesHold}
        class:hold-speak-wrap--draft-slid={draftHidesHold}
        aria-hidden={!hearReplies || draftHidesHold}
      >
        <AgentHoldToSpeak {disabled} {hearReplies} {onTranscribe} holdGated={!hearReplies} />
      </div>
    {/if}
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
    transition: gap 0.2s ease, margin-top 0.22s ease, padding 0.22s ease;
  }

  .chat-composer-audio--hold-slid {
    gap: 0;
    margin-top: 6px;
    padding-bottom: 4px;
  }

  .hold-speak-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-height: 220px;
    overflow: hidden;
    transform: translateY(0);
    opacity: 1;
    transition:
      max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1),
      opacity 0.22s ease,
      transform 0.28s cubic-bezier(0.4, 0, 0.2, 1),
      margin 0.22s ease;
  }

  /* Space reserved: same box as when visible; only paint/interaction are suppressed. */
  .hold-speak-wrap--gated {
    visibility: hidden;
    pointer-events: none;
    user-select: none;
  }

  .hold-speak-wrap--draft-slid {
    max-height: 0;
    margin-top: 0;
    margin-bottom: 0;
    padding-top: 0;
    padding-bottom: 0;
    opacity: 0;
    transform: translateY(100%);
    pointer-events: none;
    user-select: none;
    visibility: hidden;
  }
</style>
