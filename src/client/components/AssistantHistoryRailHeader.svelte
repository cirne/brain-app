<script lang="ts">
  import { X } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'
  import BrainTunnelBrandToggle from '@components/BrainTunnelBrandToggle.svelte'

  let { onClose }: { onClose: () => void } = $props()
</script>

<div
  class="assistant-history-rail-header flex h-tab shrink-0 items-center justify-between gap-2 bg-surface-2 px-3 [box-sizing:border-box]"
>
  <BrainTunnelBrandToggle
    onclick={onClose}
    ariaLabel={$t('nav.sidebar.close')}
    titleAttr={$t('nav.sidebar.close')}
  />
  <button
    type="button"
    class="rail-sidebar-close flex h-9 w-9 shrink-0 items-center justify-center text-muted transition-colors duration-150 hover:bg-surface-3 hover:text-foreground max-md:h-10 max-md:w-10 [&_svg]:max-md:h-5 [&_svg]:max-md:w-5"
    onclick={onClose}
    title={$t('nav.sidebar.close')}
    aria-label={$t('nav.sidebar.close')}
  >
    <X size={18} strokeWidth={2} aria-hidden="true" />
  </button>
</div>
