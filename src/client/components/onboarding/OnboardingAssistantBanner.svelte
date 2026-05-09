<script lang="ts">
  import { cn } from '@client/lib/cn.js'
  import { ChevronRight } from 'lucide-svelte'

  type Props = {
    onboardingState: string
    onOpenHub: () => void
    onSkipSetup?: () => void
    skipBusy?: boolean
  }

  let { onboardingState, onOpenHub, onSkipSetup, skipBusy = false }: Props = $props()

  const visible = $derived(onboardingState !== '' && onboardingState !== 'done')
</script>

{#if visible}
  <div
    class={cn(
      'flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface-2 px-3 py-2 text-sm',
    )}
    role="region"
    aria-label="Setup status"
  >
    {#if onboardingState === 'onboarding-agent'}
      <span class="min-w-0 flex-1 text-muted">
        Guided setup runs in <strong class="text-foreground">Chat</strong> — use the rest of the app anytime.
      </span>
      {#if onSkipSetup}
        <button
          type="button"
          class="shrink-0 rounded-md border border-border bg-surface-3 px-2.5 py-1 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          onclick={() => onSkipSetup()}
          disabled={skipBusy}
        >
          {skipBusy ? 'Skipping…' : 'Skip setup'}
        </button>
      {/if}
    {:else}
      <span class="min-w-0 flex-1 text-muted">
        First-time mail setup or indexing — open Brain Hub for connection steps and progress.
      </span>
    {/if}
    <button
      type="button"
      class="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-transparent px-2.5 py-1 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-3"
      onclick={() => onOpenHub()}
    >
      Open Hub
      <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" />
    </button>
  </div>
{/if}
