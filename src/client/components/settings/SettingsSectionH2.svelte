<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '@client/lib/cn.js'

  type Props = {
    label: string
    /** Optional element id for `aria-labelledby`. */
    id?: string
    class?: string
    icon?: Snippet
    /** Trailing slot (e.g. metrics); wrapped with `ml-auto` when present. */
    right?: Snippet
  }

  let { label, id, class: className, icon, right }: Props = $props()
</script>

<div
  class={cn(
    'settings-section-h2 section-header flex items-center gap-3 border-b border-border pb-3 text-foreground',
    className,
  )}
>
  {#if icon}{@render icon()}{/if}
  <h2 id={id} class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">{label}</h2>
  {#if right}
    <div class="settings-section-h2-right ml-auto flex min-w-0 shrink-0 items-center">
      {@render right()}
    </div>
  {/if}
</div>
