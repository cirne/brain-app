<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    subtitle,
    icon,
  }: {
    title: string
    subtitle: string
    icon: Snippet
  } = $props()
</script>

<div
  class="hub-source-row-body grid min-w-0 flex-1 grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-3 gap-y-[2px]"
>
  <span
    class="hub-source-icon-wrap inline-flex shrink-0 items-center justify-center text-muted [grid-column:1] [grid-row:1]"
    aria-hidden="true"
  >
    {@render icon()}
  </span>
  <span
    class="source-folder-name min-w-0 text-[0.9375rem] font-medium leading-tight text-foreground [grid-column:2] [grid-row:1]"
  >{title}</span>
  <span
    class="source-folder-path min-w-0 text-[0.8125rem] leading-snug text-muted [overflow-wrap:anywhere] [word-break:break-word] [grid-column:2] [grid-row:2]"
  >{subtitle}</span>
</div>
