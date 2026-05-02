<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '@client/lib/cn.js'

  let {
    indexing = false,
    heroClass = '',
    innerClass = '',
    ariaBusy,
    children,
  }: {
    indexing?: boolean
    heroClass?: string
    innerClass?: string
    /** Sets `aria-busy` on the outer hero (e.g. indexing step). */
    ariaBusy?: boolean | 'true' | 'false'
    children: Snippet
  } = $props()

  const outerClass = $derived(
    cn(
      'flex items-center justify-center',
      'min-h-[min(560px,85vh)] flex-1 py-14 px-6 sm:px-8 sm:py-16',
      indexing && 'min-h-0',
      heroClass,
    ),
  )

  const innerClassResolved = $derived(
    cn(
      'w-full text-center',
      indexing
        ? 'flex max-w-[22rem] min-h-0 flex-1 flex-col items-center justify-center'
        : 'max-w-md',
      innerClass,
    ),
  )
</script>

<div class={outerClass} aria-busy={ariaBusy}>
  <div class={innerClassResolved}>
    {@render children()}
  </div>
</div>
