<script lang="ts">
  import { ChevronDown, UserPlus } from 'lucide-svelte'
  import { t } from '@client/lib/i18n/index.js'
  import {
    fetchWorkspaceHandleSuggestions,
    looksLikeEmail,
    normalizeHandleInput,
    type WorkspaceHandleEntry,
  } from '@client/lib/workspaceHandleSuggest.js'

  type Props = {
    disabled?: boolean
    /** Handles (no @) already on this policy — hidden from suggestions. */
    excludeHandles?: Set<string>
    /** Called when user picks a directory row. */
    onPick: (_entry: WorkspaceHandleEntry) => void | Promise<void>
    busy?: boolean
  }

  let { disabled = false, excludeHandles = new Set(), onPick, busy = false }: Props = $props()

  let open = $state(false)
  let query = $state('')
  let suggestions = $state<WorkspaceHandleEntry[]>([])
  let loading = $state(false)
  let activeIndex = $state(0)
  let token = 0
  let rootEl: HTMLDivElement | undefined = $state(undefined)
  let searchInputEl: HTMLInputElement | undefined = $state(undefined)

  async function refreshSuggestions(q: string): Promise<void> {
    const n = normalizeHandleInput(q)
    if (n.length === 0) {
      suggestions = []
      loading = false
      return
    }
    if (looksLikeEmail(q)) {
      suggestions = []
      loading = false
      return
    }
    const myToken = ++token
    loading = true
    const { token: t, results } = await fetchWorkspaceHandleSuggestions(n, myToken)
    if (t !== token) return
    suggestions = results.filter((r) => !excludeHandles.has(r.handle.toLowerCase()))
    activeIndex = 0
    loading = false
  }

  function toggle(): void {
    if (disabled || busy) return
    open = !open
    if (open) {
      query = ''
      suggestions = []
      queueMicrotask(() => searchInputEl?.focus())
    }
  }

  function close(): void {
    open = false
    query = ''
    suggestions = []
    activeIndex = 0
  }

  async function choose(entry: WorkspaceHandleEntry): Promise<void> {
    await onPick(entry)
    close()
  }

  function onSearchInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value
    query = v
    void refreshSuggestions(v)
  }

  function onSearchKeydown(e: KeyboardEvent): void {
    if (!open) return
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex = Math.min(activeIndex + 1, suggestions.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex = Math.max(activeIndex - 1, 0)
    } else if (e.key === 'Enter') {
      const row = suggestions[activeIndex]
      if (row) {
        e.preventDefault()
        void choose(row)
      }
    }
  }

  function onDocPointerDown(ev: PointerEvent): void {
    if (!open || !rootEl) return
    const t = ev.target as Node
    if (!rootEl.contains(t)) close()
  }

  $effect(() => {
    if (typeof document === 'undefined' || !open) return
    const fn = (ev: PointerEvent) => onDocPointerDown(ev)
    document.addEventListener('pointerdown', fn, true)
    return () => document.removeEventListener('pointerdown', fn, true)
  })
</script>

<div class="add-user-dropdown relative inline-flex" bind:this={rootEl}>
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-2 px-2.5 py-1 text-[0.8125rem] font-semibold text-foreground hover:bg-surface-3 disabled:opacity-50"
    aria-expanded={open}
    aria-haspopup="listbox"
    disabled={disabled || busy}
    onclick={toggle}
  >
    <UserPlus size={14} class="shrink-0 opacity-90" aria-hidden="true" />
    {$t('access.addUserDropdown.actions.add')}
    <ChevronDown size={14} class="opacity-70" aria-hidden="true" />
  </button>

  {#if open}
    <div
      class="absolute right-0 top-full z-20 mt-1 min-w-[min(100vw-2rem,20rem)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-surface shadow-lg"
      role="listbox"
      aria-label={$t('access.addUserDropdown.aria.workspaceDirectorySearch')}
    >
      <div class="border-b border-border px-2 py-2">
        <input
          bind:this={searchInputEl}
          type="text"
          class="w-full rounded border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-surface-2 px-2 py-1.5 text-[0.8125rem] text-foreground"
          placeholder={$t('access.addUserDropdown.searchPlaceholder')}
          value={query}
          oninput={onSearchInput}
          onkeydown={onSearchKeydown}
          aria-controls="add-user-dropdown-options"
        />
      </div>
      <div id="add-user-dropdown-options" class="max-h-[min(40vh,16rem)] overflow-y-auto">
        {#if loading && suggestions.length === 0}
          <div class="px-3 py-2 text-xs text-muted">{$t('access.addUserDropdown.searching')}</div>
        {:else if suggestions.length === 0}
          <div class="px-3 py-2 text-xs text-muted">
            {normalizeHandleInput(query).length === 0
              ? $t('access.addUserDropdown.empty.typeToSearch')
              : $t('access.addUserDropdown.empty.noMatches')}
          </div>
        {:else}
          {#each suggestions as s, i (s.userId)}
            <button
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              class={[
                'add-user-dropdown-option flex w-full flex-col items-start gap-0.5 border-0 px-3 py-2 text-left [font:inherit] hover:bg-accent-dim',
                i === activeIndex ? 'bg-accent-dim' : 'bg-transparent',
              ]}
              onmousedown={(ev) => {
                ev.preventDefault()
                void choose(s)
              }}
            >
              <span class="text-[0.8125rem] font-semibold text-foreground">@{s.handle}</span>
              <span class="text-[0.75rem] leading-snug text-muted">
                {#if s.displayName?.trim()}
                  {s.displayName.trim()}
                  {#if s.primaryEmail}
                    · {s.primaryEmail}
                  {/if}
                {:else if s.primaryEmail}
                  {s.primaryEmail}
                {:else}
                  {$t('access.addUserDropdown.noEmail')}
                {/if}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
