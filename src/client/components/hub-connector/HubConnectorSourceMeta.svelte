<script lang="ts">
  import {
    sourceKindLabel,
    type HubRipmailSourceRow,
  } from '@client/lib/hub/hubRipmailSource.js'

  type Props = {
    source: HubRipmailSourceRow
  }

  let { source }: Props = $props()
</script>

<div class="hub-source-meta-compact">
  <p class="hub-source-kind-line">{sourceKindLabel(source.kind)}</p>
  {#if source.path?.trim()}
    <p class="hub-source-path-line">{source.path}</p>
  {/if}
</div>
