<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '@client/lib/cn.js'

  /**
   * One titled block in the assistant history rail (e.g. **Chats**, **Recents** —
   * chat sessions and recent docs/email share the same chrome).
   * `sectionClass` carries hook names like `ch-group--chats` for tests and layout.
   */
  let {
    sectionClass,
    headingId,
    heading,
    afterHeading,
    children,
  }: {
    sectionClass?: string
    headingId: string
    heading: string
    afterHeading?: Snippet
    children: Snippet
  } = $props()

  const groupLabelClass =
    'ch-group-label m-0 px-2 pb-2 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted max-md:text-[11px]'
</script>

<section
  class={cn(
    'ch-group flex min-w-0 w-full max-w-full flex-col',
    sectionClass,
  )}
  aria-labelledby={headingId}
>
  <h2 id={headingId} class={groupLabelClass}>
    {heading}
  </h2>
  {#if afterHeading}
    {@render afterHeading()}
  {/if}
  {@render children()}
</section>
