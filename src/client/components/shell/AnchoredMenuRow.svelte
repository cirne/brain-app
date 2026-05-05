<script lang="ts">
  import type { Snippet } from 'svelte'

  type Props = {
    onclick: () => void
    label: string
    disabled?: boolean
    leading: Snippet
  }

  let { onclick, label, disabled = false, leading }: Props = $props()

  const rowClass =
    'anchored-menu-row flex w-full items-center gap-3 border-none bg-transparent px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-45'
</script>

<button type="button" role="menuitem" class={rowClass} {onclick} {disabled}>
  <span
    class="flex h-[22px] w-[22px] shrink-0 items-center justify-center text-muted [&_svg]:pointer-events-none [&_svg]:shrink-0"
    aria-hidden="true"
  >
    {@render leading()}
  </span>
  <span class="min-w-0 flex-1">{label}</span>
</button>
