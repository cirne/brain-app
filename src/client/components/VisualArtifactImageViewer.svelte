<script lang="ts">
  import { visualArtifactFetchUrl } from '@shared/visualArtifacts.js'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'

  type ImageFitMode = 'fit' | 'actual'

  let {
    ref,
    label,
  }: {
    ref: string
    label?: string
  } = $props()

  let fitMode = $state<ImageFitMode>('fit')
  let loadError = $state(false)

  const imageUrl = $derived(visualArtifactFetchUrl(ref))
  const displayLabel = $derived(label?.trim() || $t('cards.visualArtifactImageViewer.defaultTitle'))

  function setFitMode(mode: ImageFitMode) {
    fitMode = mode
  }
</script>

<div class="visual-artifact-viewer flex min-h-0 flex-1 flex-col bg-surface">
  <div class="flex shrink-0 items-center justify-end gap-1 border-b border-border bg-surface-2 px-3 py-2">
    <div class="inline-flex overflow-hidden rounded-sm border border-border bg-surface" role="group" aria-label={$t('cards.visualArtifactImageViewer.imageSize')}>
      <button
        type="button"
        class={cn(
          'px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-3 hover:text-foreground',
          fitMode === 'fit' && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        aria-pressed={fitMode === 'fit'}
        onclick={() => setFitMode('fit')}
      >
        {$t('cards.visualArtifactImageViewer.fit')}
      </button>
      <button
        type="button"
        class={cn(
          'border-l border-border px-2.5 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-surface-3 hover:text-foreground',
          fitMode === 'actual' && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        aria-pressed={fitMode === 'actual'}
        onclick={() => setFitMode('actual')}
      >
        {$t('cards.visualArtifactImageViewer.actualSize')}
      </button>
    </div>
  </div>

  <div
    class={cn(
      'min-h-0 flex-1 overflow-auto bg-[color-mix(in_srgb,var(--bg)_86%,var(--surface))]',
      fitMode === 'fit' ? 'flex items-center justify-center p-4' : 'p-4',
    )}
  >
    {#if loadError}
      <p class="m-auto max-w-sm text-center text-sm text-muted">
        {$t('cards.visualArtifactImageViewer.loadError', { label: displayLabel })}
      </p>
    {:else}
      <img
        class={cn(
          'block',
          fitMode === 'fit'
            ? 'max-h-full max-w-full object-contain'
            : 'h-auto w-auto max-w-none object-none',
        )}
        src={imageUrl}
        alt={displayLabel}
        onerror={() => {
          loadError = true
        }}
      />
    {/if}
  </div>
</div>
