<script lang="ts">
  import {
    sourceKindLabel,
    type HubRipmailSourceRow,
  } from '@client/lib/hub/hubRipmailSource.js'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    source: HubRipmailSourceRow
  }

  let { source }: Props = $props()
</script>

<div class="hub-source-meta-compact m-0 flex flex-col gap-[0.35rem]">
  <p class="hub-source-kind-line m-0 text-[0.8125rem] font-semibold leading-[1.35] text-muted">
    {sourceKindLabel(source.kind, $t)}
  </p>
  {#if source.path?.trim()}
    <p class="hub-source-path-line m-0 text-[0.8125rem] leading-[1.45] text-muted break-words">
      {source.path}
    </p>
  {/if}
</div>
