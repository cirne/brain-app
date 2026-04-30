<script lang="ts">
  import type { MailSearchHitPreview } from '@client/lib/cards/contentCards.js'

  let {
    queryLine,
    items,
  }: {
    queryLine: string
    items: MailSearchHitPreview[] | null
  } = $props()
</script>

<div data-testid="mail-search-results-panel-stub">
  {queryLine} · {items?.length ?? 0}
</div>
