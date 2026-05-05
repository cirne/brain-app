<script lang="ts">
  import { FolderOpen } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'

  /**
   * Portal dropdown to document.body to escape SlideOver's transform stacking context.
   * Similar to AnchoredActionMenu.
   */
  function portalToBody(host: HTMLElement) {
    globalThis.document.body.appendChild(host)
    return () => host.remove()
  }

  type BreadcrumbItem = {
    label: string
    onClick?: () => void
    isCurrent?: boolean
  }

  let {
    items,
    mobilePanel = false,
    rootLabel = 'My Wiki',
  }: {
    items: BreadcrumbItem[]
    mobilePanel?: boolean
    rootLabel?: string
  } = $props()

  let containerEl = $state<HTMLElement | null>(null)
  let isOverflowing = $state(false)
  let dropdownOpen = $state(false)
  let dropdownButtonEl = $state<HTMLButtonElement | null>(null)

  // Check if content overflows
  $effect(() => {
    if (!containerEl) return

    const checkOverflow = () => {
      if (!containerEl) return
      const hasOverflow = containerEl.scrollWidth > containerEl.clientWidth
      isOverflowing = hasOverflow
    }

    checkOverflow()
    const resizeObserver = new ResizeObserver(checkOverflow)
    resizeObserver.observe(containerEl)

    return () => {
      resizeObserver.disconnect()
    }
  })

  // Calculate dropdown position relative to button
  const dropdownStyle = $derived.by(() => {
    if (!dropdownOpen || !dropdownButtonEl || typeof globalThis.window === 'undefined') return ''
    const r = dropdownButtonEl.getBoundingClientRect()
    const margin = 8
    const maxW = 320
    const width = Math.min(maxW, globalThis.window.innerWidth - 2 * margin)
    const left = r.left
    const top = r.bottom + 4
    return [
      `top:${top}px`,
      `left:${Math.max(margin, left)}px`,
      `width:${width}px`,
      `max-height:min(70vh,420px)`,
    ].join(';')
  })

  function closeDropdown() {
    dropdownOpen = false
  }

  function handleItemClick(item: BreadcrumbItem) {
    if (item.onClick) {
      item.onClick()
    }
    closeDropdown()
  }

  // Close dropdown when clicking outside
  $effect(() => {
    if (!dropdownOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownButtonEl &&
        !dropdownButtonEl.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('.breadcrumb-dropdown-portal')
      ) {
        closeDropdown()
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  })

  // Close on Escape
  function onWindowKeydown(e: KeyboardEvent) {
    if (!dropdownOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeDropdown()
    }
  }

  const breadcrumbInteractive = $derived(
    cn(
      'wiki-breadcrumb-seg inline border-none bg-transparent p-0 m-0 normal-case tracking-normal text-accent hover:underline cursor-pointer',
      mobilePanel ? 'shrink-0 whitespace-nowrap' : 'max-w-full overflow-hidden text-ellipsis whitespace-nowrap',
    ),
  )

  const breadcrumbCurrent = $derived(
    cn(
      'wiki-breadcrumb-seg wiki-breadcrumb-seg--current text-foreground font-medium cursor-default',
      mobilePanel ? 'shrink-0 whitespace-nowrap' : '',
    ),
  )

  const currentItem = $derived(items[items.length - 1])
  const hasCollapsibleItems = $derived(items.length > 1)
  // Dropdown shows path hierarchy without the current item (it's already visible in collapsed view)
  const dropdownItems = $derived(items.slice(0, -1))
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="collapsible-breadcrumb-wrapper relative flex min-w-0 flex-1 items-center">
  {#if isOverflowing && hasCollapsibleItems}
    <!-- Collapsed view with dropdown trigger -->
    <div class="flex items-center gap-1">
      <button
        bind:this={dropdownButtonEl}
        type="button"
        class={cn(
          'breadcrumb-collapse-btn inline-flex items-center gap-0.5 border-none bg-transparent p-0 m-0 text-accent hover:bg-surface-3 transition-colors',
          mobilePanel ? 'text-[15px]' : 'text-[13px]',
        )}
        onclick={() => {
          dropdownOpen = !dropdownOpen
        }}
        aria-label="Show full path"
        aria-expanded={dropdownOpen}
        aria-haspopup="menu"
      >
        <FolderOpen
          size={mobilePanel ? 16 : 14}
          strokeWidth={2}
          aria-hidden="true"
        />
        <span class={mobilePanel ? 'text-[15px]' : 'text-[13px]'}>…</span>
      </button>
      <span
        class={cn(
          'wiki-breadcrumb-sep text-muted font-normal select-none',
          mobilePanel && 'shrink-0',
        )}
        aria-hidden="true">/</span
      >
      {#if currentItem}
        <span class={breadcrumbCurrent}>{currentItem.label}</span>
      {/if}
    </div>

  {:else}
    <!-- Full breadcrumb view -->
    <div bind:this={containerEl} class="flex min-w-0 flex-1 items-center overflow-hidden">
      <span
        class={cn(
          'wiki-dir-breadcrumb items-center gap-x-1 gap-y-0 leading-snug',
          mobilePanel
            ? 'inline-flex w-max max-w-none flex-nowrap text-[15px]'
            : 'flex flex-nowrap min-w-0 text-[13px]',
        )}
        role="navigation"
        aria-label="Wiki page path"
      >
        {#if items.length === 0}
          <span class={breadcrumbCurrent}>{rootLabel}</span>
        {:else}
          {#each items as item, i (i)}
            {#if i > 0}
              <span
                class={cn(
                  'wiki-breadcrumb-sep text-muted font-normal select-none',
                  mobilePanel && 'shrink-0',
                )}
                aria-hidden="true">/</span
              >
            {/if}
            {#if item.isCurrent}
              <span class={breadcrumbCurrent}>{item.label}</span>
            {:else}
              <button type="button" class={breadcrumbInteractive} onclick={item.onClick}>
                {item.label}
              </button>
            {/if}
          {/each}
        {/if}
      </span>
    </div>
  {/if}
</div>

<!-- Portal dropdown to body to escape SlideOver transform stacking context -->
{#if dropdownOpen && dropdownButtonEl}
  <div
    class="breadcrumb-dropdown-portal pointer-events-none fixed inset-0 z-[520]"
    {@attach portalToBody}
  >
    <!-- Capture backdrop: closes dropdown -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="pointer-events-auto fixed inset-0 z-0 bg-transparent"
      role="presentation"
      aria-hidden="true"
      onclick={closeDropdown}
    ></div>
    <div
      class="breadcrumb-dropdown pointer-events-auto fixed z-[1] overflow-y-auto border border-border bg-surface-2 shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
      style={dropdownStyle}
      role="menu"
      aria-label="Full path"
      tabindex="-1"
    >
      {#each dropdownItems as item, i (i)}
        <button
          type="button"
          class={cn(
            'w-full text-left py-2 hover:bg-surface-3 transition-colors whitespace-nowrap overflow-hidden text-ellipsis border-none bg-transparent text-foreground',
            mobilePanel ? 'text-[15px]' : 'text-[13px]',
          )}
          style:padding-left={`${12 + i * 16}px`}
          onclick={() => handleItemClick(item)}
          role="menuitem"
        >
          {item.label}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .breadcrumb-dropdown {
    border-radius: 4px;
    overflow: hidden;
  }

  .breadcrumb-collapse-btn {
    padding: 2px 4px;
    border-radius: 4px;
  }
</style>
