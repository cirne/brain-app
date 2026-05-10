<script lang="ts">
  import { Mail } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'

  let {
    subject,
    from,
    snippet,
    onOpen,
  }: {
    subject: string
    from: string
    snippet: string
    onOpen: () => void
  } = $props()
</script>

<button
  type="button"
  class="email-tool-preview group mt-1 flex min-w-0 max-w-full cursor-pointer items-start gap-2 border-none bg-transparent py-1 text-left font-[inherit] text-[inherit]"
  onclick={onOpen}
  aria-label={$t('cards.emailPreviewCard.ariaOpenEmailThread', { subject })}
>
  <span class="email-tool-lead mt-px shrink-0 text-muted" aria-hidden="true">
    <Mail size={14} />
  </span>
  <span class="email-tool-body flex min-w-0 flex-col gap-1">
    <span
      class="email-tool-subject truncate text-[13px] font-semibold group-hover:text-accent"
    >{subject}</span>
    {#if from}
      <span class="email-tool-from text-[11px] text-muted">{from}</span>
    {/if}
    {#if snippet}
      <span
        class="email-tool-snippet text-xs leading-[1.4] text-muted overflow-hidden [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical]"
      >{snippet}</span>
    {/if}
  </span>
</button>
