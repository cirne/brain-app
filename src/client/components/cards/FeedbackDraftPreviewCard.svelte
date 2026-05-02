<script lang="ts">
  /**
   * Rich preview for `product_feedback` op=draft: rendered markdown with feedback issue
   * front matter (type badge + title); avoids showing raw tool output in a pre block.
   */
  import StreamingAgentMarkdown from '@components/agent-conversation/StreamingAgentMarkdown.svelte'

  let { markdown }: { markdown: string } = $props()
</script>

<div class="feedback-draft-preview min-w-0 [&_.feedback-draft-md]:text-[13px]" role="region" aria-label="Feedback draft">
  <StreamingAgentMarkdown class="feedback-draft-md" content={markdown} />
</div>
