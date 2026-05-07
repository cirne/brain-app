<script lang="ts">
  /* `$bindable` + context setter propagate to Assistant; eslint cannot trace cross-component writes. */
  /* eslint-disable no-useless-assignment */
  import type { Snippet } from 'svelte'
  import { setContext } from 'svelte'
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
    /** Own-vault / shared wiki L2 chrome (share, save hints, read-only badge). Mirrors tests’ `(s) => { ref.current = s }`. */
    wikiSlideHeader?: WikiSlideHeaderState | null
  } = $props()

  setContext(WIKI_SLIDE_HEADER, (next: WikiSlideHeaderState | null) => {
    wikiSlideHeader = next
  })
</script>

<div class="wiki-primary-shell flex min-h-0 flex-1 flex-col">
  {@render bar()}
  {@render children()}
</div>
