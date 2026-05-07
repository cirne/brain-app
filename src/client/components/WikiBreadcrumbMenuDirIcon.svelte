<script lang="ts">
  import { File } from 'lucide-svelte'
  import { getDirIcon } from '@client/lib/dirIcons.js'
  import type { ComponentType } from 'svelte'

  let { dirKey, size = 14 }: { dirKey: string; size?: number } = $props()

  let Icon = $state<ComponentType>(File)

  $effect(() => {
    Icon = getDirIcon(dirKey, (ic) => {
      Icon = ic
    })
  })
</script>

<Icon {size} strokeWidth={2} class="shrink-0 text-muted" aria-hidden="true" />
