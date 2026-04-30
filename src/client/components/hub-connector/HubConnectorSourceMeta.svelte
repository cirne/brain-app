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

<h3 class="hub-connector-title">{source.displayName}</h3>
<dl class="hub-source-meta">
  <div class="hub-source-meta-row">
    <dt>Type</dt>
    <dd>{sourceKindLabel(source.kind)}</dd>
  </div>
  <div class="hub-source-meta-row">
    <dt>Source id</dt>
    <dd class="hub-source-id">{source.id}</dd>
  </div>
  {#if source.path}
    <div class="hub-source-meta-row">
      <dt>Path</dt>
      <dd class="hub-source-path">{source.path}</dd>
    </div>
  {/if}
</dl>
