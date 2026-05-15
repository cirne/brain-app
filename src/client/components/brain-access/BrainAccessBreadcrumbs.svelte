<script lang="ts">
  import { ChevronRight } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    variant: 'list' | 'policy'
    /** Display name for the policy (policy variant). */
    policyLabel?: string
    /** Navigate to the tunnels list (policy variant). */
    onGoToList?: () => void
    /** When set, prepend “Settings” as the root crumb (unified settings hierarchy). */
    onGoToSettings?: () => void
  }

  let {
    variant,
    policyLabel = '',
    onGoToList,
    onGoToSettings,
  }: Props = $props()

  const resolvedPolicyLabel = $derived(policyLabel || $t('access.brainAccessBreadcrumbs.fallbackPolicyLabel'))

  const crumbClass =
    'border-none bg-transparent p-0 text-[0.8125rem] font-semibold text-accent [font:inherit] hover:underline'
</script>

<nav aria-label={$t('access.brainAccessBreadcrumbs.ariaLabel')} class="min-w-0">
  <ol class="m-0 flex min-w-0 list-none flex-wrap items-center gap-x-1 gap-y-1 p-0 text-[0.8125rem]">
    {#if onGoToSettings}
      <li class="min-w-0 shrink">
        <button type="button" class={crumbClass} onclick={() => onGoToSettings()}>
          {$t('settings.settingsSubpageHeader.settingsCrumb')}
        </button>
      </li>
      <li class="flex shrink-0 items-center text-muted" aria-hidden="true">
        <ChevronRight size={14} />
      </li>
    {/if}
    {#if variant === 'list'}
      <li class="truncate font-semibold text-foreground" aria-current="page">
        {$t('access.brainAccessPage.title')}
      </li>
    {:else}
      <li class="min-w-0 shrink">
        <button type="button" class={crumbClass} onclick={() => onGoToList?.()}>
          {$t('access.brainAccessPage.title')}
        </button>
      </li>
      <li class="flex shrink-0 items-center text-muted" aria-hidden="true">
        <ChevronRight size={14} />
      </li>
      <li class="min-w-0 truncate font-semibold text-foreground" aria-current="page">{resolvedPolicyLabel}</li>
    {/if}
  </ol>
</nav>
