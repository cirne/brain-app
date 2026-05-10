<script lang="ts">
  /**
   * Rich preview for `product_feedback` op=draft: rendered markdown with feedback issue
   * front matter (type badge + title); avoids showing raw tool output in a pre block.
   */
  import StreamingAgentMarkdown from '@components/agent-conversation/StreamingAgentMarkdown.svelte'
  import { t } from '@client/lib/i18n/index.js'

  let { markdown }: { markdown: string } = $props()
</script>

<div
  class="feedback-draft-preview min-w-0 [&_.feedback-draft-md]:text-[13px]"
  role="region"
  aria-label={$t('cards.feedbackDraftPreviewCard.ariaFeedbackDraft')}
>
  <StreamingAgentMarkdown class="feedback-draft-md" content={markdown} />
</div>
