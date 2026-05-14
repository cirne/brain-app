<script lang="ts">
  /**
   * Assistant text (non-tool) rendered as markdown — chat, onboarding profiling/seeding, status lines.
   */
  import { mount, unmount } from 'svelte'
  import { streamingAgentMessageHtml } from '@client/lib/agent-conversation/streamingAgentMarkdown.js'
  import WikiFileName from '@components/WikiFileName.svelte'
  import '../../styles/agent-conversation/streamingAgentMarkdown.css'

  let {
    content,
    maxLength,
    class: className = '',
  }: {
    content: string
    maxLength?: number
    class?: string
  } = $props()

  const html = $derived(streamingAgentMessageHtml(content, maxLength))

  let rootEl = $state<HTMLElement | null>(null)

  function captureRoot(element: HTMLElement) {
    rootEl = element
    return () => {
      if (rootEl === element) rootEl = null
    }
  }

  function mountWikiFileNameChips(host: HTMLElement) {
    const mounted = Array.from(
      host.querySelectorAll<HTMLElement>('[data-brain-wiki-chip][data-wiki]'),
      (target) => {
        const path = target.dataset.wiki!
        const preferredName = target.getAttribute('title')?.trim() || undefined
        target.replaceChildren()
        return mount(WikiFileName, { target, props: { path, preferredName } })
      },
    )
    return () => {
      for (const component of mounted) void unmount(component)
    }
  }

  $effect(() => {
    html
    if (!rootEl) return
    return mountWikiFileNameChips(rootEl)
  })
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class="streaming-agent-md markdown {className}" {@attach captureRoot}>{@html html}</div>
