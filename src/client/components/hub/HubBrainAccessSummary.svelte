<script lang="ts">
  import { Brain, ChevronRight } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    onManageAccess: () => void
  }

  let { onManageAccess }: Props = $props()

  const rowBtn =
    'flex w-full cursor-pointer items-center justify-between rounded-lg border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-2 p-4 text-left text-foreground transition-[background] hover:bg-surface-3 [font:inherit]'
</script>

<section
  id="hub-sharing"
  class="hub-section hub-sharing-summary flex flex-col gap-4"
  aria-label={$t('hub.hubBrainAccessSummary.ariaLabel')}
>
  <div class="flex flex-col gap-1 border-b border-border pb-3">
    <div class="flex items-center gap-2">
      <Brain size={18} aria-hidden="true" />
      <h2 class="m-0 text-[0.9375rem] font-bold tracking-[0.02em]">
        {$t('hub.hubBrainAccessSummary.title')}
      </h2>
    </div>
    <p class="m-0 max-w-[40rem] text-[0.8125rem] leading-snug text-muted">
      {$t('hub.hubBrainAccessSummary.description')}
    </p>
  </div>

  <button type="button" class={rowBtn} onclick={() => onManageAccess()}>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <span class="text-[0.9375rem] font-semibold">
        {$t('hub.hubBrainAccessSummary.manageTitle')}
      </span>
      <span class="text-[0.8125rem] text-muted">
        {$t('hub.hubBrainAccessSummary.manageSubtitle')}
      </span>
    </div>
    <ChevronRight size={18} class="shrink-0 text-muted" aria-hidden="true" />
  </button>
</section>
