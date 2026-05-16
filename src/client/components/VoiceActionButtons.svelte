<script lang="ts">
  import { RotateCcw, X } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'

  let {
    visible = false,
    disabled = false,
    embeddedInComposer = false,
    onRestart,
    onCancel,
  }: {
    visible: boolean
    disabled?: boolean
    embeddedInComposer?: boolean
    onRestart: () => void | Promise<void>
    onCancel: () => void
  } = $props()

  const dockChipBase =
    'voice-chip voice-chip--icon-only box-border inline-flex h-10 w-10 min-w-[40px] cursor-pointer items-center justify-center whitespace-nowrap border border-[var(--border-1,rgba(0,0,0,0.12))] bg-[color-mix(in_srgb,var(--bg-elevated,var(--bg))_92%,transparent)] p-0 text-foreground touch-manipulation [-webkit-tap-highlight-color:transparent] [box-shadow:0_1px_2px_rgba(0,0,0,0.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:enabled:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40'

  const composerLeadBtn =
    'inline-flex shrink-0 cursor-pointer items-center justify-center self-stretch min-w-[48px] w-[48px] border-none border-r border-r-border p-0 touch-manipulation [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:enabled:[filter:brightness(0.97)] disabled:cursor-not-allowed disabled:opacity-40'
</script>

{#if embeddedInComposer}
  <div
    class={cn(
      'voice-actions flex shrink-0 flex-row items-stretch self-stretch overflow-hidden',
      !visible && 'pointer-events-none opacity-0',
    )}
    aria-hidden={!visible}
  >
    <button
      type="button"
      class={cn(
        composerLeadBtn,
        'bg-surface text-muted hover:bg-surface-3 hover:text-foreground',
      )}
      disabled={disabled || !visible}
      aria-label={$t('chat.voice.cancelRecordingAria')}
      onclick={onCancel}
    >
      <X size={16} strokeWidth={2.25} class="voice-chip-ic" aria-hidden="true" />
    </button>
    <button
      type="button"
      class={cn(
        composerLeadBtn,
        'bg-surface-3 text-foreground hover:bg-surface hover:text-foreground',
      )}
      disabled={disabled || !visible}
      aria-label={$t('chat.voice.restartRecordingAria')}
      onclick={() => void onRestart()}
    >
      <RotateCcw size={16} strokeWidth={2.25} class="voice-chip-ic" aria-hidden="true" />
    </button>
  </div>
{:else}
  <div
    class={cn(
      'voice-actions flex min-w-0 max-w-0 flex-nowrap items-center justify-start gap-2 overflow-hidden pl-0 opacity-0 [transform:translateX(-8px)] [transition:max-width_120ms_ease-in,opacity_120ms_ease-in,transform_120ms_ease-in,padding_120ms_ease-in] pointer-events-none',
      visible &&
        'voice-actions--show max-w-[320px] opacity-100 [transform:translateX(0)] pointer-events-auto [padding-left:max(10px,env(safe-area-inset-left,0px))] [transition:max-width_180ms_ease-out,opacity_180ms_ease-out,transform_180ms_ease-out,padding_180ms_ease-out]',
    )}
    aria-hidden={!visible}
  >
    <button
      type="button"
      class={cn(dockChipBase, 'voice-chip--ghost border-transparent bg-transparent font-medium text-muted [box-shadow:none]')}
      disabled={disabled || !visible}
      aria-label={$t('chat.voice.cancelRecordingAria')}
      onclick={onCancel}
    >
      <X size={16} strokeWidth={2.25} class="voice-chip-ic" aria-hidden="true" />
    </button>
    <button
      type="button"
      class={dockChipBase}
      disabled={disabled || !visible}
      aria-label={$t('chat.voice.restartRecordingAria')}
      onclick={() => void onRestart()}
    >
      <RotateCcw size={16} strokeWidth={2.25} class="voice-chip-ic" aria-hidden="true" />
    </button>
  </div>
{/if}

<style>
  /* Lucide icon class — must escape Svelte's scoped CSS so the icon class still applies. */
  :global(.voice-chip-ic) {
    flex-shrink: 0;
    opacity: 0.9;
  }
</style>
