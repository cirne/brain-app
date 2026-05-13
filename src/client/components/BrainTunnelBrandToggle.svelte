<script lang="ts">
  import { BrainCircuit } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'
  import { cn } from '@client/lib/cn.js'

  /** Product lockup shared with the history rail header: one icon + wordmark control. */
  let {
    onclick,
    /** When false, only the Brain icon is shown (e.g. narrow top bar beside a chat-title center). */
    showTitle = true,
    ariaLabel,
    /** Native `title`; defaults to ariaLabel. */
    titleAttr,
    wrapperClass,
    /** Pending tunnel messages — accent count badge on the lockup (sidebar attention). */
    pendingBadgeCount = 0,
  }: {
    onclick: () => void
    showTitle?: boolean
    ariaLabel: string
    titleAttr?: string
    wrapperClass?: string
    pendingBadgeCount?: number
  } = $props()
</script>

<button
  type="button"
  onclick={onclick}
  class={cn(
    'brain-tunnel-brand-toggle inline-flex min-h-0 min-w-0 max-w-[min(100%,42vw)] items-center gap-2 border-none bg-transparent p-0 text-left [&_svg]:shrink-0 [&_svg]:text-muted',
    'rounded-sm text-foreground transition-colors duration-150 hover:text-foreground hover:[&_svg]:text-muted',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
    !showTitle && 'max-w-none justify-center',
    pendingBadgeCount > 0 && 'relative',
    wrapperClass,
  )}
  title={titleAttr ?? ariaLabel}
  aria-label={ariaLabel}
>
  <BrainCircuit size={18} strokeWidth={2} aria-hidden="true" />
  {#if showTitle}
    <span
      class="min-w-0 overflow-hidden truncate whitespace-nowrap text-[15px] font-semibold tracking-[0.02em] text-foreground max-md:text-lg"
    >{$t('common.brand.name')}</span>
  {/if}
  {#if pendingBadgeCount > 0}
    <span
      class="pointer-events-none absolute right-0 top-0 flex h-[1.1rem] min-w-[1.1rem] translate-x-0.5 -translate-y-0.5 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] font-bold leading-none text-white"
      aria-hidden="true"
    >
      {pendingBadgeCount > 99 ? '99+' : String(pendingBadgeCount)}
    </span>
  {/if}
</button>
