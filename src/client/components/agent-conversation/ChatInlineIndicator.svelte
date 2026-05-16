<script lang="ts">
  import { cn } from '@client/lib/cn.js'

  let {
    icon,
    children,
    class: className = '',
    variant = 'default',
    /** When true, omit the leading icon box (e.g. wiki title already has a lead icon). */
    labelOnly = false,
  }: {
    icon?: import('svelte').Snippet
    children: import('svelte').Snippet
    class?: string
    variant?: 'default' | 'error'
    labelOnly?: boolean
  } = $props()
</script>

<span
  data-chat-inline-indicator
  class={cn(
    'inline-flex min-w-0 max-w-full items-center gap-1.5',
    variant === 'error' && 'text-danger',
    className,
  )}
>
  {#if icon && !labelOnly}
    <span
      class="tool-transcript-icon inline-flex size-3.5 shrink-0 items-center justify-center [&>svg]:block"
      aria-hidden="true"
    >
      {@render icon()}
    </span>
  {/if}
  {@render children()}
</span>
