<script lang="ts">
  import { cn } from '@client/lib/cn.js'

  let {
    icon,
    children,
    class: className = '',
    variant = 'default',
    /** When true, omit the leading icon box (e.g. wiki title already has a lead icon). */
    labelOnly = false,
    /**
     * `inherit`: size/leading come from the parent row (e.g. tool compact `text-[13px] leading-[1.45]`).
     * Avoid duplicating typography classes on every label.
     */
    inlineMetrics = 'default' as 'default' | 'inherit',
  }: {
    icon?: import('svelte').Snippet
    children: import('svelte').Snippet
    class?: string
    variant?: 'default' | 'error'
    labelOnly?: boolean
    inlineMetrics?: 'default' | 'inherit'
  } = $props()
</script>

<span
  data-chat-inline-indicator
  class={cn(
    'inline-flex max-w-full min-w-0 items-center gap-1.5 text-muted',
    inlineMetrics === 'inherit'
      ? 'min-h-0 text-inherit leading-inherit'
      : 'min-h-6 text-[11px]',
    variant === 'error' && 'text-danger',
    className,
  )}
>
  {#if icon && !labelOnly}
    <span
      class="tool-transcript-icon inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center [&>svg]:block"
      aria-hidden="true"
    >
      {@render icon()}
    </span>
  {/if}
  <span class="min-w-0 leading-[inherit] [&_.tool-name]:leading-[inherit]">{@render children()}</span>
</span>
