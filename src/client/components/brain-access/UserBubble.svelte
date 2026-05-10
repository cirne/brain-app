<script lang="ts">
  import { ChevronDown } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'
  import type { NavigateOptions, Overlay } from '@client/router.js'

  type Props = {
    grantId: string
    handle: string
    disabled?: boolean
    onSettingsNavigate: (_overlay: Overlay, _opts?: NavigateOptions) => void
    policyIdForDetail: string
    onChangePolicy: () => void
    onRemove: () => void | Promise<void>
    removeBusy?: boolean
  }

  let {
    grantId,
    handle,
    disabled = false,
    onSettingsNavigate,
    policyIdForDetail,
    onChangePolicy,
    onRemove,
    removeBusy = false,
  }: Props = $props()

  let menuOpen = $state(false)
  let rootEl: HTMLDivElement | undefined = $state(undefined)

  function closeMenu(): void {
    menuOpen = false
  }

  function goDetail(): void {
    closeMenu()
    onSettingsNavigate(
      { type: 'brain-access-policy', policyId: policyIdForDetail },
      { replace: false },
    )
    queueMicrotask(() => {
      document.getElementById(`grant-row-${grantId}`)?.scrollIntoView({ block: 'nearest' })
    })
  }

  function viewLogs(): void {
    closeMenu()
    onSettingsNavigate({ type: 'brain-access-policy', policyId: policyIdForDetail })
  }

  $effect(() => {
    if (typeof document === 'undefined' || !menuOpen) return
    const fn = (ev: PointerEvent) => {
      const t = ev.target as Node
      if (rootEl && !rootEl.contains(t)) closeMenu()
    }
    document.addEventListener('pointerdown', fn, true)
    return () => document.removeEventListener('pointerdown', fn, true)
  })
</script>

<div class="user-bubble-wrap relative inline-flex" bind:this={rootEl}>
  <button
    type="button"
    class="inline-flex items-center gap-0.5 rounded-full border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-2 px-2 py-1 text-[0.8125rem] font-medium text-foreground hover:bg-surface-3 disabled:opacity-50"
    aria-expanded={menuOpen}
    aria-haspopup="menu"
    disabled={disabled || removeBusy}
    onclick={() => {
      menuOpen = !menuOpen
    }}
  >
    @{handle}
    <ChevronDown size={12} class="opacity-60" aria-hidden="true" />
  </button>

  {#if menuOpen}
    <div
      role="menu"
      class="absolute left-0 top-full z-30 mt-1 min-w-[12rem] rounded-md border border-border bg-surface py-1 shadow-lg"
    >
      <button type="button" role="menuitem" class="menu-item" onclick={goDetail}>
        {$t('access.userBubble.actions.viewUserDetails')}
      </button>
      <button type="button" role="menuitem" class="menu-item" onclick={viewLogs}>
        {$t('access.userBubble.actions.viewAllLogs')}
      </button>
      <button type="button" role="menuitem" class="menu-item" onclick={() => { closeMenu(); onChangePolicy() }}>
        {$t('access.userBubble.actions.changePolicy')}
      </button>
      <hr class="my-1 border-border" />
      <button
        type="button"
        role="menuitem"
        class="menu-item text-red-600 dark:text-red-400"
        disabled={removeBusy}
        onclick={() => {
          closeMenu()
          void onRemove()
        }}
      >
        {removeBusy ? $t('access.userBubble.actions.removing') : $t('access.userBubble.actions.removeAccess')}
      </button>
    </div>
  {/if}
</div>

<style>
  .menu-item {
    display: block;
    width: 100%;
    border: none;
    background: transparent;
    text-align: left;
    padding: 0.45rem 0.75rem;
    font: inherit;
    font-size: 0.8125rem;
    cursor: pointer;
    color: var(--text, inherit);
  }
  .menu-item:hover:not(:disabled) {
    background: var(--accent-dim, rgba(37, 99, 235, 0.12));
  }
  .menu-item:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
