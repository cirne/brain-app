<script lang="ts">
  /**
   * Scroll region + follow-output behavior shared by onboarding profiling and wiki seeding views.
   */
  import { onMount, tick, type Snippet } from 'svelte'
  import { computePinnedToBottom } from '../scrollPin.js'

  let {
    messages,
    streaming,
    streamingWrite = null,
    children,
  }: {
    messages: unknown[]
    streaming: boolean
    streamingWrite?: { path: string; body: string } | null
    children: Snippet<[{ reduceMotion: boolean }]>
  } = $props()

  let messagesEl: HTMLElement
  let followOutput = $state(true)
  /** Temporarily ignore scroll events during programmatic scrolls so followOutput does not toggle off. */
  let ignoreScrollEvents = false
  let reduceMotion = $state(false)

  function syncFollowFromScroll() {
    if (!messagesEl || ignoreScrollEvents) return
    followOutput = computePinnedToBottom(messagesEl)
  }

  export function scrollToBottom() {
    ignoreScrollEvents = true
    void tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!messagesEl) {
            ignoreScrollEvents = false
            return
          }
          messagesEl.scrollTop = messagesEl.scrollHeight
          followOutput = true
          ignoreScrollEvents = false
        })
      })
    })
  }

  export function scrollToBottomIfFollowing() {
    if (!followOutput) return
    ignoreScrollEvents = true
    void tick().then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!messagesEl) {
            ignoreScrollEvents = false
            return
          }
          if (followOutput) {
            messagesEl.scrollTop = messagesEl.scrollHeight
          }
          ignoreScrollEvents = false
        })
      })
    })
  }

  onMount(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      reduceMotion = mq.matches
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  })

  $effect(() => {
    void messages
    void streaming
    void streamingWrite?.body
    if (streaming && followOutput) scrollToBottomIfFollowing()
  })
</script>

<div class="ob-prof-shell">
  <div
    class="ob-prof-scroll"
    bind:this={messagesEl}
    onscroll={syncFollowFromScroll}
  >
    <div class="ob-prof-inner">
      {@render children({ reduceMotion })}
    </div>
  </div>
</div>

<style>
  .ob-prof-shell {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-2);
  }

  .ob-prof-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overflow-x: hidden;
  }

  .ob-prof-inner {
    max-width: var(--chat-column-max);
    margin: 0 auto;
    padding: 1.25rem 1rem 2rem;
    box-sizing: border-box;
  }
</style>
