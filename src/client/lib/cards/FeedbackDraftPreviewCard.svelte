<script lang="ts">
  /**
   * Rich preview for `product_feedback` op=draft: rendered markdown with feedback issue
   * front matter (type badge + title); avoids showing raw tool output in a pre block.
   */
  import StreamingAgentMarkdown from '../agent-conversation/StreamingAgentMarkdown.svelte'

  let { markdown }: { markdown: string } = $props()
</script>

<div class="feedback-draft-preview" role="region" aria-label="Feedback draft">
  <StreamingAgentMarkdown class="feedback-draft-md" content={markdown} />
</div>

<style>
  .feedback-draft-preview {
    min-width: 0;
  }

  :global(.feedback-draft-preview .feedback-draft-md) {
    font-size: 13px;
  }
</style>
