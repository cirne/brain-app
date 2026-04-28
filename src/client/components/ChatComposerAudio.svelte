<script lang="ts">
  import { onMount } from 'svelte'
  import { isPressToTalkEnabled } from '@client/lib/pressToTalkEnabled.js'
  import HearRepliesControl from './HearRepliesControl.svelte'

  const pressToTalkUiEnabled = isPressToTalkEnabled()

  let {
    /** When false, hide the hear-replies toggle (e.g. header shows it once there are messages). */
    showHearRepliesToggle = true,
    hearReplies = false,
    onHearRepliesChange,
  }: {
    showHearRepliesToggle?: boolean
    hearReplies?: boolean
    onHearRepliesChange: (_value: boolean) => void
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
  <div class="chat-composer-audio">
    {#if showHearRepliesToggle}
      <HearRepliesControl {hearReplies} {onHearRepliesChange} />
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
  }
</style>
