<script lang="ts">
  /**
   * Scroll region + follow-output behavior shared by onboarding profiling and wiki seeding views.
   */
  import { onMount, tick, type Snippet } from 'svelte'
  import { computePinnedToBottom } from '@client/lib/scrollPin.js'

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

<div
  class="onboarding-activity-transcript flex min-h-0 min-w-0 flex-1 flex-col bg-surface-2 [font:inherit]"
>
  <div
    class="onboarding-activity-scroll chat-transcript-scroll box-border min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden px-[length:var(--chat-transcript-px)] [font:inherit]"
    bind:this={messagesEl}
    onscroll={syncFollowFromScroll}
  >
    {@render children({ reduceMotion })}
  </div>
</div>
