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
    /** Leading row icon. Omit when the main content already includes its own marker (e.g. WikiFileName). */
    icon?: Snippet
  } = $props()

  const singleMain = $derived(titleContent !== undefined && subtitleContent === undefined && subtitle === '')
  const hasIcon = $derived(icon !== undefined)
</script>

<div
  class={cn(
    'hub-source-row-body grid min-w-0 flex-1 grid-rows-[auto_auto] items-center gap-x-3 gap-y-[2px]',
    hasIcon ? 'grid-cols-[auto_1fr]' : 'grid-cols-1',
    singleMain && 'single-main gap-y-0',
  )}
>
  {#if icon}
    <span
      class="hub-source-icon-wrap inline-flex shrink-0 items-center justify-center self-center text-muted [grid-column:1] [grid-row:1]"
      aria-hidden="true"
    >
      {@render icon()}
    </span>
  {/if}
  {#if titleContent}
    <span
      class={cn(
        'source-folder-name min-w-0 text-[0.9375rem] font-medium leading-tight text-foreground [grid-row:1]',
        hasIcon ? '[grid-column:2]' : '[grid-column:1]',
      )}
    >
      {@render titleContent()}
    </span>
  {:else}
    <span
      class={cn(
        'source-folder-name min-w-0 text-[0.9375rem] font-medium leading-tight text-foreground [grid-row:1]',
        hasIcon ? '[grid-column:2]' : '[grid-column:1]',
      )}
    >{title}</span>
  {/if}
  {#if subtitleContent}
    <span
      class={cn(
        'source-folder-path min-w-0 text-[0.8125rem] leading-snug text-muted [overflow-wrap:anywhere] [word-break:break-word] [grid-row:2]',
        hasIcon ? '[grid-column:2]' : '[grid-column:1]',
      )}
    >{@render subtitleContent()}</span>
  {:else if subtitle !== ''}
    <span
      class={cn(
        'source-folder-path min-w-0 text-[0.8125rem] leading-snug text-muted [overflow-wrap:anywhere] [word-break:break-word] [grid-row:2]',
        hasIcon ? '[grid-column:2]' : '[grid-column:1]',
      )}
    >{subtitle}</span>
  {/if}
</div>
