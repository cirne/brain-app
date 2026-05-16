<script lang="ts">
  import { FileEdit } from '@lucide/svelte'
  import { t } from '@client/lib/i18n/index.js'

  let {
    draftId,
    subject,
    snippet,
    onOpen,
  }: {
    draftId: string
    subject: string
    snippet: string
    onOpen: () => void
  } = $props()
</script>

<button
  type="button"
  class="draft-tool-preview group mt-1 flex min-w-0 max-w-full cursor-pointer items-start gap-2 border-none bg-transparent py-1 text-left font-[inherit] text-[inherit]"
  onclick={onOpen}
  aria-label={$t('cards.draftPreviewCard.ariaOpenEmailDraft', { subject })}
>
  <span class="draft-tool-lead mt-px shrink-0 text-muted" aria-hidden="true">
    <FileEdit size={14} />
  </span>
  <span class="draft-tool-body flex min-w-0 flex-col gap-1">
    <span class="draft-tool-subject truncate text-[13px] font-semibold group-hover:text-accent">{subject}</span>
    <span class="draft-tool-id font-mono text-[11px] text-muted">{draftId}</span>
    {#if snippet}
      <span
        class="draft-tool-snippet text-xs leading-[1.4] text-muted overflow-hidden [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical]"
      >{snippet}</span>
    {/if}
  </span>
</button>
