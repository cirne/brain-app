<script lang="ts">
  import { Mail } from 'lucide-svelte'

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
  class="my-2 block w-full cursor-pointer rounded-lg border border-border bg-surface-3 p-2.5 px-3 text-left text-inherit [font:inherit]"
  onclick={onOpen}
  aria-label="Open email thread: {subject}"
>
  <div class="flex min-w-0 items-center gap-2">
    <Mail size={14} aria-hidden="true" />
    <span class="min-w-0 overflow-hidden text-[13px] font-semibold text-ellipsis [white-space:nowrap]">
      {subject}
    </span>
  </div>
  {#if from}
    <div class="mt-1 text-xs text-muted">{from}</div>
  {/if}
  {#if snippet}
    <p class="m-0 mt-2 text-xs leading-snug text-muted">{snippet}</p>
  {/if}
</button>
