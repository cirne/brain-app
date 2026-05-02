<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '@client/lib/cn.js'

  let {
    title = '',
    subtitle = '',
    titleContent,
    subtitleContent,
    icon,
  }: {
    title?: string
    subtitle?: string
    /** Primary label (e.g. WikiFileName). When set, `title` is ignored. */
    titleContent?: Snippet
    /** Secondary line. When set, `subtitle` is ignored. Omit both for single-line rows. */
    subtitleContent?: Snippet
    icon: Snippet
  } = $props()

  const singleMain = $derived(titleContent !== undefined && subtitleContent === undefined && subtitle === '')
</script>

<div
  class={cn(
    'hub-source-row-body grid min-w-0 flex-1 grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-3 gap-y-[2px]',
    singleMain && 'single-main gap-y-0',
  )}
>
  <span
    class="hub-source-icon-wrap inline-flex shrink-0 items-center justify-center self-center text-muted [grid-column:1] [grid-row:1]"
    aria-hidden="true"
  >
    {@render icon()}
  </span>
  {#if titleContent}
    <span
      class="source-folder-name min-w-0 text-[0.9375rem] font-medium leading-tight text-foreground [grid-column:2] [grid-row:1]"
    >
      {@render titleContent()}
    </span>
  {:else}
    <span
      class="source-folder-name min-w-0 text-[0.9375rem] font-medium leading-tight text-foreground [grid-column:2] [grid-row:1]"
    >{title}</span>
  {/if}
  {#if subtitleContent}
    <span
      class="source-folder-path min-w-0 text-[0.8125rem] leading-snug text-muted [overflow-wrap:anywhere] [word-break:break-word] [grid-column:2] [grid-row:2]"
    >{@render subtitleContent()}</span>
  {:else if subtitle !== ''}
    <span
      class="source-folder-path min-w-0 text-[0.8125rem] leading-snug text-muted [overflow-wrap:anywhere] [word-break:break-word] [grid-column:2] [grid-row:2]"
    >{subtitle}</span>
  {/if}
</div>
