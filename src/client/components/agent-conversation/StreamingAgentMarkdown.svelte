<script lang="ts">
  /**
   * Assistant text (non-tool) rendered as markdown — chat, onboarding profiling/seeding, status lines.
   */
  import { streamingAgentMessageHtml } from '@client/lib/agent-conversation/streamingAgentMarkdown.js'
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
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class="streaming-agent-md markdown {className}">{@html html}</div>
