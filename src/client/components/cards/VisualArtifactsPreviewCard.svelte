<script lang="ts">
  import { FileText } from '@lucide/svelte'
  import { visualArtifactFetchUrl, type VisualArtifact } from '@shared/visualArtifacts.js'
  import { t } from '@client/lib/i18n/index.js'

  let {
    artifacts,
    onOpenVisualArtifact,
  }: {
    artifacts: VisualArtifact[]
    onOpenVisualArtifact?: (_ref: string, _label?: string) => void
  } = $props()

  let imageErrors = $state<Record<string, true>>({})

  function previewUrl(artifact: VisualArtifact): string | null {
    return artifact.ref ? visualArtifactFetchUrl(artifact.ref) : null
  }

  function markImageError(ref: string) {
    imageErrors[ref] = true
  }

  function openImageArtifact(ref: string, label: string) {
    onOpenVisualArtifact?.(ref, label)
  }

  function fallbackText(artifact: VisualArtifact): string {
    if (artifact.readStatus === 'too_large') return `${artifact.label} is too large to preview.`
    if (artifact.readStatus === 'missing') return `${artifact.label} is no longer available.`
    if (artifact.readStatus === 'unsupported') return `${artifact.label} cannot be previewed.`
    return `${artifact.label} preview is unavailable.`
  }
</script>

<div class="visual-artifacts-preview mt-1 flex max-w-full flex-col gap-2">
  {#each artifacts as artifact, index (`${artifact.ref ?? artifact.label}-${index}`)}
    {@const url = previewUrl(artifact)}
    {#if artifact.readStatus === 'available' && url && artifact.ref && artifact.kind === 'image'}
      {@const ref = artifact.ref}
      <figure class="visual-artifact-image m-0 overflow-hidden">
        {#if onOpenVisualArtifact}
          <button
            type="button"
            class="group block w-full cursor-zoom-in border border-border bg-[var(--chip-bg,rgba(0,0,0,0.04))] p-0 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onclick={() => openImageArtifact(ref, artifact.label)}
            aria-label={$t('cards.visualArtifactsPreviewCard.ariaOpenImagePreview', { label: artifact.label })}
          >
            <img class="block max-h-44 w-full object-contain" src={url} alt={artifact.label} loading="lazy" onerror={() => markImageError(ref)} />
          </button>
        {:else}
          <img class="block max-h-44 w-full border border-border bg-[var(--chip-bg,rgba(0,0,0,0.04))] object-contain" src={url} alt={artifact.label} loading="lazy" onerror={() => markImageError(ref)} />
        {/if}
        {#if imageErrors[ref]}
          <figcaption class="px-2 py-1.5 text-[11px] leading-[1.4] text-muted [overflow-wrap:anywhere]">
            <span class="block text-[11px] text-muted">{$t('cards.visualArtifactsPreviewCard.loadError', { label: artifact.label })}</span>
          </figcaption>
        {/if}
      </figure>
    {:else if artifact.readStatus === 'available' && url && artifact.kind === 'pdf'}
      <a
        class="visual-artifact-pdf group flex min-w-0 max-w-full items-center gap-2 border border-border bg-[var(--chip-bg,rgba(0,0,0,0.04))] px-2 py-2 text-left text-[12px] text-foreground no-underline hover:border-accent"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={$t('cards.visualArtifactsPreviewCard.ariaOpenPdfPreview', { label: artifact.label })}
      >
        <span
          class="flex h-12 w-10 shrink-0 flex-col items-center justify-center border border-border bg-background text-[10px] font-semibold text-muted"
          aria-hidden="true"
        >
          <FileText size={16} strokeWidth={2} />
          PDF
        </span>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="truncate font-medium group-hover:text-accent">{artifact.label}</span>
          <span class="text-[11px] text-muted">{$t('cards.visualArtifactsPreviewCard.openPdfNewTab')}</span>
        </span>
      </a>
    {:else}
      <p
        class="visual-artifact-fallback m-0 border border-border bg-[var(--chip-bg,rgba(0,0,0,0.04))] px-2 py-1.5 text-[11px] leading-[1.4] text-muted [overflow-wrap:anywhere]"
      >
        {fallbackText(artifact)}
      </p>
    {/if}
  {/each}
</div>
