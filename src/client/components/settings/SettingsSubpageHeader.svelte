<script lang="ts">
  import type { Snippet } from 'svelte'
  import { ChevronRight } from '@lucide/svelte'
  import PaneL2Header from '@components/PaneL2Header.svelte'
  import { t } from '@client/lib/i18n/index.js'

  type Props = {
    /** Current subpage title (last crumb when using default center). */
    pageTitle: string
    /** Navigate to `/settings` root (no overlay). */
    onNavigateToSettingsRoot: () => void
    /** Replace default “Settings › title” center region (e.g. nested brain-access crumbs). */
    customCenter?: Snippet
  }

  let { pageTitle, onNavigateToSettingsRoot, customCenter }: Props = $props()

  const crumbBtn =
    'border-none bg-transparent p-0 text-[0.8125rem] font-semibold text-accent [font:inherit] hover:underline'
</script>

<PaneL2Header>
  {#snippet center()}
    {#if customCenter}
      {@render customCenter()}
    {:else}
      <nav aria-label={$t('settings.settingsSubpageHeader.navAriaLabel')} class="min-w-0">
        <ol class="m-0 flex min-w-0 list-none flex-wrap items-center gap-x-1 gap-y-1 p-0 text-[0.8125rem]">
          <li class="min-w-0 shrink">
            <button type="button" class={crumbBtn} onclick={() => onNavigateToSettingsRoot()}>
              {$t('settings.settingsSubpageHeader.settingsCrumb')}
            </button>
          </li>
          <li class="flex shrink-0 items-center text-muted" aria-hidden="true">
            <ChevronRight size={14} />
          </li>
          <li class="truncate font-semibold text-foreground" aria-current="page">{pageTitle}</li>
        </ol>
      </nav>
    {/if}
  {/snippet}
</PaneL2Header>
