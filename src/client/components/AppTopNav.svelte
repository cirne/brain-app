<script lang="ts">
  import type { Snippet } from 'svelte'
  import {
    BookOpen,
    EllipsisVertical,
    MessageSquarePlus,
    Search,
    Settings,
  } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'
  import AnchoredActionMenu from '@components/shell/AnchoredActionMenu.svelte'
  import BrainTunnelBrandToggle from '@components/BrainTunnelBrandToggle.svelte'

  type Props = {
    /** When false, hides the chat history control (e.g. onboarding uses the same top bar without history). */
    showChatHistoryButton?: boolean
    /** Whether the history sidebar is open (desktop or mobile). */
    sidebarOpen?: boolean
    isMobile?: boolean
    onToggleSidebar: () => void
    syncErrors: string[]
    showSyncErrors: boolean
    onOpenSearch: () => void
    onToggleSyncErrors: () => void
    /** Opens Settings (`/settings`). */
    onOpenSettings?: () => void
    onNewChat?: () => void
    /** When true, new-chat is disabled (already on idle `/c` with nothing in the bar — ⌘N is a no-op). */
    isEmptyChat?: boolean
    /**
     * Hosted only: `@handle` next to Hub after onboarding confirmation.
     * Omitted in the top bar on narrow viewports; use the top Settings control instead.
     */
    hostedHandlePill?: string
    /** Pending wiki share invites — dot on Settings / @handle when set; opens Sharing with badge. */
    shareInviteBadge?: boolean
    /** When pending invites exist, opens Settings scrolled to Sharing (`#sharing`). */
    onOpenSharing?: () => void
    onWikiHome?: () => void
    /** Brain-to-brain: pending tunnel messages — badge on sidebar open controls only. */
    reviewPendingCount?: number
    /** Mobile-only (OPP-092): truncated chat title between brand and actions. */
    mobileCenterTitle?: string
    /** Mobile-only overflow sheet rows — receives `dismiss` to close the sheet after each action. */
    mobileOverflow?: Snippet<[{ dismiss: () => void }]>
    /** Accent dot on the ⋯ button (sync errors, invites, etc.). */
    mobileOverflowAlert?: boolean
  }

  let {
    showChatHistoryButton = true,
    sidebarOpen = false,
    isMobile = false,
    onToggleSidebar,
    syncErrors,
    showSyncErrors,
    onOpenSearch,
    onToggleSyncErrors,
    onOpenSettings,
    onNewChat,
    isEmptyChat = false,
    hostedHandlePill,
    shareInviteBadge = false,
    onOpenSharing,
    onWikiHome,
    reviewPendingCount = 0,
    mobileCenterTitle,
    mobileOverflow,
    mobileOverflowAlert = false,
  }: Props = $props()

  const mobileCompactNav = $derived(Boolean(isMobile && mobileOverflow))

  /** Center brand only when chat history chrome is omitted (onboarding); otherwise the rail + left toggle carry the wordmark. */
  const showCenterBrand = $derived(!showChatHistoryButton)

  let overflowOpen = $state(false)
  let overflowTriggerEl = $state<HTMLButtonElement | null>(null)

  /** Routes click: pending invite → Sharing, otherwise plain Settings. */
  function handleSettingsClick() {
    if (shareInviteBadge && onOpenSharing) onOpenSharing()
    else onOpenSettings?.()
  }

  /** Shared icon-button recipe used across the action row. */
  const iconBtn =
    'inline-flex h-full w-10 min-w-10 items-center justify-center gap-0 border-none bg-transparent p-0 text-muted transition-colors duration-150 [box-sizing:border-box] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent hover:bg-surface-3 hover:text-foreground'
  const iconBtnLabeled = 'w-auto gap-1.5 px-2.5'
  const navActionLabel =
    'nav-action-label whitespace-nowrap text-[13px] font-semibold tracking-[0.02em] text-inherit max-md:text-base'

  function sidebarOpenAriaWithPending(baseAria: string): string {
    const n = reviewPendingCount
    if (n <= 0) return baseAria
    return `${baseAria} (${$t('chat.rail.pendingCountAria', { count: n })})`
  }
</script>

<nav
  class="tabs flex h-tab shrink-0 items-stretch border-b border-border bg-surface-2"
>
  {#if showChatHistoryButton && !sidebarOpen}
    <div
      class={cn(
        'nav-left nav-left--collapsed flex min-h-full shrink-0 items-center bg-surface-2 [box-sizing:border-box]',
        'w-auto min-w-0 px-1.5',
      )}
    >
      <BrainTunnelBrandToggle
        onclick={onToggleSidebar}
        showTitle={!(mobileCompactNav && Boolean(mobileCenterTitle))}
        ariaLabel={sidebarOpenAriaWithPending(`${$t('common.brand.name')}, ${$t('nav.sidebar.open')}`)}
        titleAttr={$t('nav.sidebar.open')}
        pendingBadgeCount={reviewPendingCount}
      />
    </div>
  {/if}
  <div
    class={cn(
      'brand flex min-w-0 flex-1 items-center px-3.5',
      !showCenterBrand && !mobileCompactNav && 'brand--silent pointer-events-none',
      mobileCompactNav && 'min-w-0 px-2',
    )}
  >
    {#if mobileCompactNav && mobileCenterTitle}
      <button
        type="button"
        class={cn(
          'mobile-nav-title min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left text-[15px] font-semibold tracking-[0.02em] text-foreground cursor-pointer',
          reviewPendingCount > 0 && showChatHistoryButton && 'relative pe-9',
        )}
        onclick={showChatHistoryButton ? onToggleSidebar : undefined}
        aria-label={showChatHistoryButton
          ? sidebarOpenAriaWithPending(
              `${mobileCenterTitle} - ${sidebarOpen ? $t('nav.sidebar.close') : $t('nav.sidebar.open')}`,
            )
          : mobileCenterTitle}
      >{mobileCenterTitle}
        {#if reviewPendingCount > 0 && showChatHistoryButton}
          <span
            class="pointer-events-none absolute right-0 top-1/2 flex h-[1.1rem] min-w-[1.1rem] -translate-y-1/2 translate-x-0.5 items-center justify-center rounded-full bg-accent px-1 text-[0.625rem] font-bold leading-none text-white"
            aria-hidden="true"
          >
            {reviewPendingCount > 99 ? '99+' : String(reviewPendingCount)}
          </span>
        {/if}
      </button>
    {:else if showCenterBrand}
      <span class="brand-name text-[15px] font-semibold tracking-[0.02em] text-foreground max-md:text-lg">{$t('common.brand.name')}</span>
    {/if}
  </div>
  <div class="nav-actions flex shrink-0 items-stretch gap-0.5 pl-2" aria-label={$t('nav.topActions')}>
    {#if !mobileCompactNav}
      <div class="search-wrap flex shrink-0 items-center">
        <button
          class={cn(iconBtn, '[&_svg]:max-md:h-[18px] [&_svg]:max-md:w-[18px]')}
          onclick={onOpenSearch}
          title={$t('nav.search.openWithShortcut')}
          aria-label={$t('nav.search.open')}
        >
          <Search size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {#if onWikiHome}
        <div class="wiki-home-wrap flex shrink-0 items-center">
          <button
            type="button"
            class={cn(
              iconBtn,
              '[&_svg]:max-md:h-[18px] [&_svg]:max-md:w-[18px]',
              !isMobile && cn('wiki-home-btn--labeled', iconBtnLabeled),
            )}
            onclick={onWikiHome}
            title={$t('nav.wiki.homeWithShortcut')}
            aria-label={isMobile ? $t('nav.wiki.home') : undefined}
          >
            <BookOpen size={15} strokeWidth={2} aria-hidden="true" />
            {#if !isMobile}<span class={navActionLabel}>{$t('nav.wiki.label')}</span>{/if}
          </button>
        </div>
      {/if}
      {#if onNewChat}
        <div class="new-wrap flex shrink-0 items-center">
          <button
            type="button"
            class={cn(
              iconBtn,
              'disabled:cursor-not-allowed disabled:opacity-45',
              '[&_svg]:max-md:h-[18px] [&_svg]:max-md:w-[18px]',
              !isMobile && cn('new-nav-btn--labeled', iconBtnLabeled),
              isMobile && 'max-md:h-9 max-md:min-h-9',
            )}
            disabled={isEmptyChat}
            onclick={onNewChat}
            title={isEmptyChat ? $t('nav.chat.alreadyInNewChat') : $t('nav.chat.newWithShortcut')}
            aria-label={isEmptyChat ? $t('nav.chat.newConversationAlreadyEmpty') : isMobile ? $t('nav.chat.newConversation') : undefined}
          >
            <MessageSquarePlus size={15} strokeWidth={2.25} aria-hidden="true" />
            {#if !isMobile}<span class={navActionLabel}>{$t('nav.chat.label')}</span>{/if}
          </button>
        </div>
      {/if}
      {#if onOpenSettings && (isMobile || !hostedHandlePill)}
        <div class="settings-wrap flex shrink-0 items-center">
          <button
            type="button"
            class={cn(
              iconBtn,
              '[&_svg]:max-md:h-[18px] [&_svg]:max-md:w-[18px]',
              !isMobile && cn('settings-nav-btn--labeled', iconBtnLabeled),
              shareInviteBadge && 'settings-nav-btn--badge relative pr-3.5',
            )}
            onclick={handleSettingsClick}
            title={$t('nav.settings.title')}
            aria-label={isMobile ? $t('nav.settings.label') : undefined}
          >
            <Settings size={15} strokeWidth={2} aria-hidden="true" />
            {#if !isMobile}<span class={navActionLabel}>{$t('nav.settings.label')}</span>{/if}
          </button>
        </div>
      {/if}
    {:else}
      {#if onNewChat}
        <div class="new-wrap flex shrink-0 items-center">
          <button
            type="button"
            class={cn(
              iconBtn,
              'disabled:cursor-not-allowed disabled:opacity-45',
              '[&_svg]:max-md:h-[18px] [&_svg]:max-md:w-[18px]',
              'max-md:h-9 max-md:min-h-9',
            )}
            disabled={isEmptyChat}
            onclick={onNewChat}
            title={isEmptyChat ? $t('nav.chat.alreadyInNewChat') : $t('nav.chat.newWithShortcut')}
            aria-label={isEmptyChat ? $t('nav.chat.newConversationAlreadyEmpty') : $t('nav.chat.newConversation')}
          >
            <MessageSquarePlus size={15} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      {/if}
      {#if mobileOverflow}
        <div class="relative flex shrink-0 items-center">
          <button
            bind:this={overflowTriggerEl}
            type="button"
            class={cn(iconBtn, 'relative max-md:h-9 max-md:min-h-9', '[&_svg]:max-md:h-[18px] [&_svg]:max-md:w-[18px]')}
            onclick={() => {
              overflowOpen = !overflowOpen
            }}
            title={$t('nav.menu.moreActions')}
            aria-label={$t('nav.menu.moreActions')}
            aria-expanded={overflowOpen}
            aria-haspopup="menu"
          >
            <EllipsisVertical size={18} strokeWidth={2} aria-hidden="true" />
            {#if mobileOverflowAlert}
              <span
                class="pointer-events-none absolute right-1 top-1 h-2 w-2 rounded-full bg-[#e74c3c]"
                aria-hidden="true"
              ></span>
            {/if}
          </button>
        </div>
      {/if}
    {/if}
    <div class="sync-wrap relative flex shrink-0 items-stretch">
      {#if hostedHandlePill && onOpenSettings && !isMobile}
        <button
          type="button"
          class={cn(
            'nav-hosted-handle ml-2 mr-1.5 max-w-[9rem] cursor-pointer self-center overflow-hidden truncate whitespace-nowrap border-none bg-transparent px-2 py-1 font-mono text-xs font-medium text-muted hover:bg-surface-3 hover:text-foreground',
            shareInviteBadge && 'nav-hosted-handle--badge relative pr-3.5',
          )}
          onclick={handleSettingsClick}
          title={$t('nav.settings.workspace')}
        >
          @{hostedHandlePill}
        </button>
      {/if}
      {#if syncErrors.length > 0}
        <button
          class="sync-error-badge absolute right-1 top-1 flex h-3.5 w-3.5 cursor-pointer items-center justify-center bg-[#e74c3c] text-[9px] font-bold leading-none text-white hover:bg-[#c0392b]"
          onclick={onToggleSyncErrors}
          title={$t('nav.sync.showErrors')}
        >!</button>
        {#if showSyncErrors}
          <div
            class="sync-error-popup absolute right-0 top-[calc(100%+4px)] z-[200] min-w-[220px] overflow-hidden border border-[#e74c3c] bg-surface-3 [box-shadow:0_4px_12px_rgba(0,0,0,0.4)]"
          >
            <div
              class="sync-error-title border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#e74c3c]"
            >{$t('nav.sync.errorsTitle')}</div>
            {#each syncErrors as err, i (i)}
              <div
                class="sync-error-item whitespace-pre-wrap break-words px-3 py-1.5 font-mono text-xs text-foreground"
              >{err}</div>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </div>
</nav>

{#if mobileCompactNav && mobileOverflow}
  <AnchoredActionMenu
    open={overflowOpen}
    anchorEl={overflowTriggerEl}
    menuLabel={$t('nav.menu.moreActions')}
    onDismiss={() => {
      overflowOpen = false
    }}
  >
    {#snippet children()}
      {@render mobileOverflow({ dismiss: () => {
        overflowOpen = false
      } })}
    {/snippet}
  </AnchoredActionMenu>
{/if}

<style>
  /*
   * Pseudo-element badges (top-right accent dot). Kept as scoped CSS because
   * Tailwind ::after with positioned dot is awkward inline.
   */
  .nav-hosted-handle--badge::after {
    content: '';
    position: absolute;
    top: 5px;
    right: 6px;
    width: 6px;
    height: 6px;
background: var(--accent);
  }

  .settings-nav-btn--badge::after {
    content: '';
    position: absolute;
    top: 8px;
    right: 6px;
    width: 6px;
    height: 6px;
background: var(--accent);
  }

  /* Mobile labeled Settings button: nudge dot to keep it clear of the text. */
  @media (max-width: 768px) {
    .settings-nav-btn--badge.settings-nav-btn--labeled::after {
      top: 8px;
      right: 10px;
    }
  }

  :global(.sync-wrap) :global(.hub-widget) {
    font-size: inherit;
  }
</style>
