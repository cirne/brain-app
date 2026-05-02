<script lang="ts">
  /* Svelte $bindable() + $effect.pre parent sync; eslint cannot see cross-component reads. */
  /* eslint-disable no-useless-assignment */
  import type { Snippet } from 'svelte'
  import { createSlideHeaderRegistration } from '@client/lib/slideHeaderContextRegistration.svelte.js'
  import { WIKI_SLIDE_HEADER } from '@client/lib/wikiSlideHeaderContext.js'
  import type { WikiSlideHeaderRegistration } from '@client/lib/wikiSlideHeaderContext.js'

  let {
    bar,
    children,
    wikiHdrRef = $bindable<WikiSlideHeaderRegistration | null>(null),
  }: {
    bar: Snippet
    children: Snippet
    wikiHdrRef?: WikiSlideHeaderRegistration | null
  } = $props()

  const wikiHdr: WikiSlideHeaderRegistration = createSlideHeaderRegistration(WIKI_SLIDE_HEADER)
  $effect.pre(() => {
    wikiHdrRef = wikiHdr
  })
</script>

<div class="wiki-primary-shell flex min-h-0 flex-1 flex-col">
  {@render bar()}
  {@render children()}
</div>
