<script lang="ts">
  /* `$bindable` mirrors `wikiHdr.current` for Assistant wiki-primary bar chrome. */
  import type { Snippet } from 'svelte'
  import { createSlideHeaderCell } from '@client/lib/slideHeaderContextRegistration.svelte.js'
  import {
    WIKI_SLIDE_HEADER,
    type WikiSlideHeaderState,
  } from '@client/lib/wikiSlideHeaderContext.js'

  let {
    bar,
    children,
    wikiSlideHeader = $bindable<WikiSlideHeaderState | null>(null),
  }: {
    bar: Snippet
    children: Snippet
    /** Own-vault / shared wiki L2 chrome (share, save hints, read-only badge). Updated from header cell snapshot. */
    wikiSlideHeader?: WikiSlideHeaderState | null
  } = $props()

  const wikiHdr = createSlideHeaderCell<WikiSlideHeaderState>(WIKI_SLIDE_HEADER)

  $effect(() => {
    const next = wikiHdr.current
    if (!Object.is(wikiSlideHeader, next)) wikiSlideHeader = next
  })
</script>

<div class="wiki-primary-shell flex min-h-0 flex-1 flex-col">
  {@render bar()}
  {@render children()}
</div>
