<script lang="ts">
  import { BookOpen, BrainCircuit, MessageSquarePlus, Search, X, Settings } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import BrainHubWidget from '@tw-components/BrainHubWidget.svelte'

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
    onOpenHub: () => void
    /** L1 “New” — same flow as sidebar / ⌘N (e.g. `historyNewChat`). */
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
    /** Hosted and desktop: opens Settings (`/settings`). */
    onOpenSettings?: () => void
    /** When pending invites exist, opens Settings scrolled to Sharing (`#sharing`). */
    onOpenSharing?: () => void
    /** Wiki vault root (`index.md` / resolved landing) — optional; hidden when omitted (e.g. onboarding). */
    onWikiHome?: () => void
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
    onOpenHub,
    onNewChat,
    isEmptyChat = false,
    hostedHandlePill,
    shareInviteBadge = false,
    onOpenSettings,
    onOpenSharing,
    onWikiHome,
  }: Props = $props()

  /** Sidebar open (wide header + list): desktop or mobile. */
  const navOpen = $derived(sidebarOpen)
  /** Center title only when there is no left nav (e.g. onboarding); otherwise title lives in the sidebar control. */
  const showCenterBrand = $derived(!showChatHistoryButton)

  /** Routes click: pending invite → Sharing, otherwise plain Settings. */
  function handleSettingsClick() {
    if (shareInviteBadge && onOpenSharing) onOpenSharing()
    else onOpenSettings?.()
  }

  /** Shared icon-button recipe used across the action row. */
  const iconBtn =
    'inline-flex h-full w-10 min-w-10 items-center justify-center gap-0 rounded-md border-none bg-transparent p-0 text-muted transition-colors duration-150 [box-sizing:border-box] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent hover:bg-surface-3 hover:text-foreground'
  const iconBtnLabeled = 'w-auto gap-1.5 px-2.5'
  const navActionLabel =
    'nav-action-label whitespace-nowrap text-[13px] font-semibold tracking-[0.02em] text-inherit max-md:text-base'
</script>

<nav
  class="tabs flex h-tab shrink-0 items-stretch border-b border-border bg-surface-2"
>
  {#if showChatHistoryButton}
    <div
      class={cn(
        'nav-left flex min-h-full shrink-0 items-center justify-between gap-2 bg-surface-2 [box-sizing:border-box]',
        navOpen
          ? 'nav-left--wide w-sidebar-history min-w-sidebar-history px-3 max-md:w-sidebar-history-mobile max-md:min-w-sidebar-history-mobile'
          : 'nav-left--collapsed w-auto min-w-10 px-1.5',
      )}
    >
      {#if navOpen}
        <div class="nav-brand-lockup flex min-w-0 items-center gap-2 text-foreground [&_svg]:shrink-0 [&_svg]:text-muted">
          <BrainCircuit size={18} strokeWidth={2} aria-hidden="true" />
          <span
            class="nav-brand-title overflow-hidden truncate whitespace-nowrap text-[15px] font-semibold tracking-[0.02em] max-md:text-lg"
          >Braintunnel</span>
        </div>
        <button
          type="button"
          class="nav-sidebar-close flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-3 hover:text-foreground max-md:h-10 max-md:w-10 [&_svg]:max-md:h-5 [&_svg]:max-md:w-5"
          onclick={onToggleSidebar}
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      {:else}
        <button
          class="menu-btn flex h-full min-h-tab min-w-0 items-center justify-start gap-2 py-0 pl-0.5 pr-1 text-muted transition-colors duration-150 hover:text-foreground [&_svg]:shrink-0 [&_svg]:max-md:h-5 [&_svg]:max-md:w-5"
          type="button"
          onclick={onToggleSidebar}
          title="Open sidebar"
          aria-label="Open sidebar"
        >
          <BrainCircuit size={18} strokeWidth={2} aria-hidden="true" />
          <span
            class="nav-brand-title min-w-0 overflow-hidden truncate whitespace-nowrap text-[15px] font-semibold tracking-[0.02em] max-md:text-lg"
          >Braintunnel</span>
        </button>
      {/if}
    </div>
  {/if}
  <div
    class={cn(
      'brand flex min-w-0 flex-1 items-center px-3.5',
      !showCenterBrand && 'brand--silent pointer-events-none',
    )}
  >
    {#if showCenterBrand}
      <span class="brand-name text-[15px] font-semibold tracking-[0.02em] text-foreground max-md:text-lg">Braintunnel</span>
    {/if}
  </div>
  <div class="nav-actions flex shrink-0 items-stretch gap-0.5 pl-2" aria-label="Top actions">
    <div class="search-wrap flex shrink-0 items-center">
      <button
        class={cn(iconBtn, '[&_svg]:max-md:h-[18px] [&_svg]:max-md:w-[18px]')}
        onclick={onOpenSearch}
        title="Search (⌘K)"
        aria-label="Search"
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
          title="Wiki home (⌘⇧H)"
          aria-label={isMobile ? 'Wiki home' : undefined}
        >
          <BookOpen size={15} strokeWidth={2} aria-hidden="true" />
          {#if !isMobile}<span class={navActionLabel}>Wiki</span>{/if}
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
          title={isEmptyChat ? 'Already in new chat' : 'New chat (⌘N)'}
          aria-label={isEmptyChat ? 'New conversation (already empty)' : isMobile ? 'New conversation' : undefined}
        >
          <MessageSquarePlus size={15} strokeWidth={2.25} aria-hidden="true" />
          {#if !isMobile}<span class={navActionLabel}>Chat</span>{/if}
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
          title="Settings"
          aria-label={isMobile ? 'Settings' : undefined}
        >
          <Settings size={15} strokeWidth={2} aria-hidden="true" />
          {#if !isMobile}<span class={navActionLabel}>Settings</span>{/if}
        </button>
      </div>
    {/if}
    <div class="sync-wrap relative flex shrink-0 items-stretch">
      {#if hostedHandlePill && onOpenSettings && !isMobile}
        <button
          type="button"
          class={cn(
            'nav-hosted-handle ml-2 mr-1.5 max-w-[9rem] cursor-pointer self-center overflow-hidden truncate whitespace-nowrap rounded-md border-none bg-transparent px-2 py-1 font-mono text-xs font-medium text-muted hover:bg-surface-3 hover:text-foreground',
            shareInviteBadge && 'nav-hosted-handle--badge relative pr-3.5',
          )}
          onclick={handleSettingsClick}
          title="Workspace settings"
        >
          @{hostedHandlePill}
        </button>
      {/if}
      <BrainHubWidget onOpen={onOpenHub} />
      {#if syncErrors.length > 0}
        <button
          class="sync-error-badge absolute right-1 top-1 flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full bg-[#e74c3c] text-[9px] font-bold leading-none text-white hover:bg-[#c0392b]"
          onclick={onToggleSyncErrors}
          title="Show sync errors"
        >!</button>
        {#if showSyncErrors}
          <div
            class="sync-error-popup absolute right-0 top-[calc(100%+4px)] z-[200] min-w-[220px] overflow-hidden rounded-md border border-[#e74c3c] bg-surface-3 [box-shadow:0_4px_12px_rgba(0,0,0,0.4)]"
          >
            <div
              class="sync-error-title border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#e74c3c]"
            >Sync errors</div>
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
    border-radius: 50%;
    background: var(--accent);
  }

  .settings-nav-btn--badge::after {
    content: '';
    position: absolute;
    top: 8px;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  /* Mobile labeled Settings button: nudge dot to keep it clear of the text. */
  @media (max-width: 768px) {
    .settings-nav-btn--badge.settings-nav-btn--labeled::after {
      top: 8px;
      right: 10px;
    }
  }

  /* Mobile sizing for sub-elements rendered inside the hub widget (`:global` reach). */
  :global(.sync-wrap) :global(.hub-widget) {
    font-size: inherit;
  }
  @media (max-width: 768px) {
    :global(.sync-wrap) :global(.hub-widget) {
      font-size: 18px;
    }
    :global(.sync-wrap) :global(.wiki-page-count-indicator) {
      font-size: 18px;
    }
    :global(.sync-wrap) :global(.pulse-container) {
      width: 16px;
      height: 16px;
    }
    :global(.sync-wrap) :global(.pulse-dot) {
      width: 9px;
      height: 9px;
    }
    :global(.sync-wrap) :global(svg.wpc-book) {
      width: 18px;
      height: 18px;
    }
  }
</style>
