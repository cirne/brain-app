<script lang="ts">
  import {
    Check,
    ChevronDown,
    ChevronRight,
    Folder,
    FolderOpen,
    RefreshCw,
    Sparkles,
    X,
  } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import type { HubSourceDetailFileSource } from '@client/lib/hub/hubRipmailSource.js'

  type DriveFolderSuggestion = {
    id: string
    name: string
    reason: string
    include: boolean
  }

  type Props = {
    sourceId: string
    fileSource: HubSourceDetailFileSource | null
    includeSharedWithMe: boolean
    onSaved: () => void
  }

  let { sourceId, fileSource, includeSharedWithMe, onSaved }: Props = $props()

  /** Plain-language skips when the model returns globs but no summary. */
  const DRIVE_SKIP_FALLBACK_SUMMARY =
    'Applying also adds skips for temporary files, Office lock files, unfinished downloads, backups, archives, and common audio and video.'

  // ---------- draft state ----------

  type DraftRoot = { id: string; name: string; recursive: boolean }

  function blankFileSource(): HubSourceDetailFileSource {
    return {
      roots: [],
      includeGlobs: [],
      ignoreGlobs: [],
      maxFileBytes: 10_000_000,
      respectGitignore: true,
    }
  }

  let roots = $state<DraftRoot[]>([])
  let ignoreGlobs = $state<string[]>([])
  let maxFileMb = $state(10)
  let sharedWithMe = $state(false)

  let advancedOpen = $state(false)

  let ignoreText = $state('')
  let advancedDirty = $state(false)

  $effect.pre(() => {
    void sourceId
    const fs = fileSource ?? blankFileSource()
    roots = fs.roots.map((r) => ({ ...r }))
    ignoreGlobs = [...fs.ignoreGlobs]
    ignoreText = fs.ignoreGlobs.join('\n')
    maxFileMb = Math.round(fs.maxFileBytes / 1_000_000) || 10
    sharedWithMe = includeSharedWithMe
    advancedDirty = false
  })

  // ---------- save helpers ----------

  let saveBusy = $state(false)
  let saveErr = $state<string | null>(null)

  async function saveFileSource(updatedRoots: DraftRoot[], updatedIgnoreGlobs?: string[]): Promise<boolean> {
    saveBusy = true
    saveErr = null
    try {
      const payload: HubSourceDetailFileSource = {
        ...(fileSource ?? blankFileSource()),
        roots: updatedRoots,
        ignoreGlobs: updatedIgnoreGlobs ?? ignoreGlobs,
        maxFileBytes: maxFileMb * 1_000_000,
      }
      const res = await fetch('/api/hub/sources/update-file-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourceId, fileSource: payload }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) throw new Error(j.error || 'Save failed')
      onSaved()
      return true
    } catch (e) {
      saveErr = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      saveBusy = false
    }
  }

  async function saveSharedWithMe(v: boolean): Promise<void> {
    const res = await fetch('/api/hub/sources/update-include-shared-with-me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sourceId, include: v }),
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || !j.ok) {
      saveErr = j.error || 'Could not update Shared with me'
      sharedWithMe = !v
    } else {
      onSaved()
    }
  }

  // ---------- folder actions ----------

  function removeRoot(i: number) {
    const next = roots.filter((_, j) => j !== i)
    roots = next
    void saveFileSource(next)
  }

  function setRecursive(i: number, v: boolean) {
    const next = roots.slice()
    next[i] = { ...next[i], recursive: v }
    roots = next
    void saveFileSource(next)
  }

  function addFolder(f: { id: string; name: string }) {
    if (roots.some((r) => r.id === f.id)) return
    const next = [...roots, { id: f.id, name: f.name, recursive: true }]
    roots = next
    browserOpen = false
    void saveFileSource(next)
  }

  // ---------- folder browser ----------

  let browserOpen = $state(false)
  let browserLoading = $state(false)
  let browserErr = $state<string | null>(null)
  let browserFolders = $state<{ id: string; name: string; hasChildren: boolean }[]>([])
  let browserStack = $state<{ id: string; name: string }[]>([])

  async function loadBrowser(parentId: string | undefined) {
    browserLoading = true
    browserErr = null
    try {
      const u = new URL('/api/hub/sources/browse-folders', window.location.origin)
      u.searchParams.set('id', sourceId)
      if (parentId) u.searchParams.set('parentId', parentId)
      const res = await fetch(u.toString())
      const j = (await res.json()) as { ok?: boolean; folders?: typeof browserFolders; error?: string }
      if (!res.ok || !j.ok) throw new Error(j.error || 'Could not list folders')
      browserFolders = Array.isArray(j.folders) ? j.folders : []
    } catch (e) {
      browserErr = e instanceof Error ? e.message : String(e)
      browserFolders = []
    } finally {
      browserLoading = false
    }
  }

  function openBrowser() {
    browserOpen = true
    browserStack = []
    void loadBrowser(undefined)
  }

  function browserEnter(f: { id: string; name: string }) {
    browserStack = [...browserStack, f]
    void loadBrowser(f.id)
  }

  function browserUp() {
    const next = browserStack.slice(0, -1)
    browserStack = next
    void loadBrowser(next.length ? next[next.length - 1].id : undefined)
  }

  // ---------- AI suggestions ----------

  let suggestBusy = $state(false)
  let suggestErr = $state<string | null>(null)
  let suggestions = $state<DriveFolderSuggestion[]>([])
  let suggestionGlobs = $state<string[]>([])
  /** Human sentence from POST / sources/suggest-drive-folders */
  let suggestionSummary = $state('')
  let suggestSelected = $state<Set<string>>(new Set())
  let suggestOpen = $state(false)

  async function loadSuggestions() {
    suggestBusy = true
    suggestErr = null
    browserOpen = false
    try {
      const res = await fetch('/api/hub/sources/suggest-drive-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourceId }),
      })
      const j = (await res.json()) as {
        ok?: boolean
        suggestions?: DriveFolderSuggestion[]
        ignoreGlobs?: string[]
        ignoreSummary?: string
        error?: string
      }
      if (!res.ok || !j.ok) throw new Error(j.error || 'Suggestions failed')
      suggestions = Array.isArray(j.suggestions) ? j.suggestions : []
      suggestionGlobs = Array.isArray(j.ignoreGlobs) ? j.ignoreGlobs : []
      suggestionSummary = typeof j.ignoreSummary === 'string' ? j.ignoreSummary : ''
      suggestSelected = new Set(suggestions.filter((s) => s.include).map((s) => s.id))
      suggestOpen = true
    } catch (e) {
      suggestErr = e instanceof Error ? e.message : String(e)
    } finally {
      suggestBusy = false
    }
  }

  function toggleSuggestion(id: string) {
    const next = new Set(suggestSelected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    suggestSelected = next
  }

  async function applySuggestions() {
    const toAdd = suggestions
      .filter((s) => suggestSelected.has(s.id) && !roots.some((r) => r.id === s.id))
      .map((s) => ({ id: s.id, name: s.name, recursive: true }))
    const next = [...roots, ...toAdd]
    const mergedGlobs = [
      ...ignoreGlobs,
      ...suggestionGlobs.filter((g) => !ignoreGlobs.includes(g)),
    ]
    roots = next
    ignoreGlobs = mergedGlobs
    ignoreText = mergedGlobs.join('\n')
    suggestOpen = false
    await saveFileSource(next, mergedGlobs)
  }

  // ---------- advanced settings ----------

  function onIgnoreTextInput(e: Event) {
    ignoreText = (e.currentTarget as HTMLTextAreaElement).value
    advancedDirty = true
  }

  function onMaxMbInput(e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value)
    if (Number.isFinite(v) && v > 0) maxFileMb = Math.floor(v)
    advancedDirty = true
  }

  async function saveAdvanced() {
    const globs = ignoreText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    ignoreGlobs = globs
    const ok = await saveFileSource(roots, globs)
    if (ok) advancedDirty = false
  }

  async function toggleSharedWithMe() {
    sharedWithMe = !sharedWithMe
    await saveSharedWithMe(sharedWithMe)
  }

  const selectedCount = $derived([...suggestSelected].filter((id) => !roots.some((r) => r.id === id)).length)

  const suggestionGlobsPending = $derived(suggestionGlobs.filter((g) => !ignoreGlobs.includes(g)))
  const canApplySuggestions = $derived(selectedCount > 0 || suggestionGlobsPending.length > 0)

  const driveSuggestHumanSkipsLine = $derived.by(() => {
    const trimmed = suggestionSummary.trim()
    if (trimmed) return trimmed
    if (suggestionGlobsPending.length > 0) return DRIVE_SKIP_FALLBACK_SUMMARY
    return ''
  })

  /** Inlined dialog button styles — avoids relying on `:global()` rules from the parent panel. */
  const hubDialogBtnBase =
    'hub-dialog-btn cursor-pointer rounded-md border border-transparent px-[0.9rem] py-[0.45rem] text-sm font-semibold transition-[background-color,color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-60'
  const hubDialogBtnPrimary =
    'hub-dialog-btn-primary bg-accent text-white border-[color-mix(in_srgb,var(--accent)_80%,black)] hover:not-disabled:brightness-[1.06]'
  const hubDialogBtnSecondary =
    'hub-dialog-btn-secondary bg-transparent text-foreground border-[color-mix(in_srgb,var(--border)_80%,transparent)] hover:not-disabled:bg-surface-2'

  const driveCtaBtn = 'drive-cta-btn inline-flex items-center gap-[0.4rem]'
  const driveActionBtn = 'drive-action-btn inline-flex items-center gap-[0.35rem] text-[0.8125rem]'

  const hubIconBtn =
    'hub-icon-btn cursor-pointer bg-transparent border-none p-1 inline-flex items-center justify-center text-muted hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed'

  const driveErr = 'drive-err m-0 text-[0.8125rem] text-danger'
  const driveHeading =
    'drive-heading m-0 text-xs font-semibold uppercase tracking-[0.03em] opacity-85'
</script>

<section
  class="drive-section mt-1 flex flex-col gap-[0.6rem]"
  aria-labelledby="drive-folders-heading"
>
  <h2 id="drive-folders-heading" class={driveHeading}>Folders</h2>

  {#if saveErr}
    <p class={driveErr} role="alert">{saveErr}</p>
  {/if}

  <!-- Empty state -->
  {#if roots.length === 0 && !suggestOpen && !browserOpen}
    <p class="drive-empty-hint m-0 text-[0.8125rem] leading-[1.45] text-muted">
      Choose which Drive folders Braintunnel indexes. Braintunnel requires at least one folder.
    </p>
    <div class="drive-empty-ctas flex flex-wrap gap-2">
      <button
        type="button"
        class={cn(hubDialogBtnBase, hubDialogBtnPrimary, driveCtaBtn)}
        disabled={suggestBusy}
        onclick={() => void loadSuggestions()}
      >
        {#if suggestBusy}
          <RefreshCw size={15} aria-hidden="true" class="drive-spin" />
          Analyzing your Drive…
        {:else}
          <Sparkles size={15} aria-hidden="true" />
          Suggest folders with AI
        {/if}
      </button>
      <button
        type="button"
        class={cn(hubDialogBtnBase, hubDialogBtnSecondary, driveCtaBtn)}
        onclick={openBrowser}
      >
        <Folder size={15} aria-hidden="true" />
        Browse folders
      </button>
    </div>
    {#if suggestErr}
      <p class={driveErr} role="alert">{suggestErr}</p>
    {/if}
  {:else}
    <!-- Folder cards -->
    {#if roots.length > 0}
      <ul class="drive-folder-list m-0 flex list-none flex-col gap-[0.4rem] p-0" role="list">
        {#each roots as root, i (root.id)}
          <li
            class="drive-folder-card box-border flex min-h-11 items-center gap-2 border border-[color-mix(in_srgb,var(--border)_88%,transparent)] bg-[color-mix(in_srgb,var(--bg-2,var(--bg))_94%,var(--text))] px-3 py-[0.55rem]"
          >
            <span class="drive-folder-icon flex shrink-0 items-center text-muted" aria-hidden="true">
              <Folder size={16} />
            </span>
            <span
              class="drive-folder-name min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-[-0.015em]"
            >{root.name}</span>
            <label
              class="drive-subfolder-toggle flex shrink-0 cursor-pointer items-center gap-[0.3rem]"
              title="Include subfolders"
            >
              <input
                type="checkbox"
                checked={root.recursive}
                onchange={(e) => setRecursive(i, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span class="drive-subfolder-label whitespace-nowrap text-xs text-muted">Subfolders</span>
            </label>
            <button
              type="button"
              class={cn(hubIconBtn, 'drive-remove-btn shrink-0 hover:text-danger')}
              aria-label="Remove {root.name}"
              disabled={saveBusy}
              onclick={() => removeRoot(i)}
            >
              <X size={15} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Add folder / Suggest row -->
    {#if !browserOpen && !suggestOpen}
      <div class="drive-actions-row flex flex-wrap gap-2">
        <button
          type="button"
          class={cn(hubDialogBtnBase, hubDialogBtnSecondary, driveActionBtn)}
          onclick={openBrowser}
        >
          <FolderOpen size={14} aria-hidden="true" />
          Add folder
        </button>
        <button
          type="button"
          class={cn(hubDialogBtnBase, hubDialogBtnSecondary, driveActionBtn)}
          disabled={suggestBusy}
          onclick={() => void loadSuggestions()}
        >
          {#if suggestBusy}
            <RefreshCw size={14} aria-hidden="true" class="drive-spin" />
            Analyzing…
          {:else}
            <Sparkles size={14} aria-hidden="true" />
            Suggest
          {/if}
        </button>
      </div>
      {#if suggestErr}
        <p class={driveErr} role="alert">{suggestErr}</p>
      {/if}
    {/if}
  {/if}

  <!-- AI suggestion panel -->
  {#if suggestOpen}
    <div
      class="drive-suggest-panel flex flex-col gap-2 border border-[color-mix(in_srgb,var(--accent,#6366f1)_30%,var(--border))] bg-[color-mix(in_srgb,var(--accent,#6366f1)_5%,var(--bg))] px-3 py-[0.65rem]"
    >
      <div class="drive-suggest-header flex items-center gap-[0.4rem] text-accent">
        <Sparkles size={14} aria-hidden="true" />
        <span class="drive-suggest-title flex-1 text-[0.8125rem] font-semibold">Suggested folders</span>
        <button
          type="button"
          class={cn(hubIconBtn, 'drive-suggest-close')}
          aria-label="Dismiss suggestions"
          onclick={() => (suggestOpen = false)}
        >
          <X size={14} />
        </button>
      </div>
      {#if suggestions.length === 0}
        <p class="drive-suggest-empty m-0 text-[0.8125rem] text-muted">
          No folders found in your Drive to suggest.
        </p>
      {:else}
        <ul
          class="drive-suggest-list m-0 flex list-none flex-col gap-[0.35rem] p-0"
          role="list"
        >
          {#each suggestions as s (s.id)}
            {@const checked = suggestSelected.has(s.id)}
            {@const alreadyAdded = roots.some((r) => r.id === s.id)}
            <li
              class={cn(
                'drive-suggest-row border-b border-[color-mix(in_srgb,var(--border)_60%,transparent)] py-[0.35rem] last:border-b-0',
                !alreadyAdded && !checked && 'drive-suggest-row--skip opacity-60',
                alreadyAdded && 'drive-suggest-row--inactive opacity-95',
              )}
            >
              <label
                class={cn(
                  'drive-suggest-label flex cursor-pointer items-start gap-[0.55rem]',
                  alreadyAdded && 'drive-suggest-label--inactive cursor-default',
                )}
              >
                <input
                  type="checkbox"
                  class="drive-suggest-sr-input absolute h-px w-px overflow-hidden whitespace-nowrap border-0 [clip:rect(0_0_0_0)]"
                  {checked}
                  disabled={alreadyAdded}
                  aria-label={alreadyAdded
                    ? `${s.name}, already in your folders`
                    : `${checked ? 'Deselect' : 'Select'} ${s.name}`}
                  onchange={() => toggleSuggestion(s.id)}
                />
                <span
                  class="drive-suggest-check mt-[0.1rem] flex h-5 w-5 shrink-0 items-center justify-center"
                  aria-hidden="true"
                >
                  {#if alreadyAdded}
                    <span
                      class="drive-suggest-marker drive-suggest-marker--added box-border inline-flex h-5 w-5 items-center justify-center text-xs border border-[color-mix(in_srgb,var(--border)_92%,transparent)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-muted"
                    >
                      <Check size={12} aria-hidden="true" strokeWidth={2.5} />
                    </span>
                  {:else if checked}
                    <span
                      class="drive-suggest-marker drive-suggest-marker--on box-border inline-flex h-5 w-5 items-center justify-center bg-accent text-white text-xs"
                    >✓</span>
                  {:else}
                    <span
                      class="drive-suggest-marker drive-suggest-marker--off box-border inline-flex h-5 w-5 items-center justify-center border-2 border-[color-mix(in_srgb,var(--text)_26%,transparent)]"
                    ></span>
                  {/if}
                </span>
                <span class="drive-suggest-info flex min-w-0 flex-col gap-[0.1rem]">
                  <span class="drive-suggest-folder-name text-[0.9rem] font-semibold">{s.name}</span>
                  {#if s.reason}
                    <span class="drive-suggest-reason text-[0.8rem] leading-[1.35] text-muted">{s.reason}</span>
                  {/if}
                </span>
              </label>
            </li>
          {/each}
        </ul>
        {#if suggestionGlobs.length > 0}
          {#if suggestionGlobsPending.length > 0}
            {#if driveSuggestHumanSkipsLine}
              <p class="drive-suggest-hint m-0 text-[0.8rem] leading-[1.42] text-muted">
                {driveSuggestHumanSkipsLine}
              </p>
            {/if}
            <details
              class="drive-suggest-details border border-[color-mix(in_srgb,var(--border)_82%,transparent)] bg-[color-mix(in_srgb,var(--bg)_85%,var(--text))] px-2 py-[0.35rem] text-[0.78rem] text-muted"
            >
              <summary
                class="drive-suggest-details-summary cursor-pointer select-none px-[0.1rem] font-medium text-foreground"
              >
                Technical patterns (optional)
              </summary>
              <p
                class="drive-suggest-details-note mt-[0.35rem] text-[0.76rem] leading-[1.38] text-muted"
              >
                These are merged into <strong>Ignore patterns</strong> under Advanced when you apply.
              </p>
              <pre
                class="drive-suggest-patterns mt-[0.45rem] max-h-36 overflow-auto whitespace-pre-wrap break-all border border-[color-mix(in_srgb,var(--border)_75%,transparent)] bg-[color-mix(in_srgb,var(--bg-2,var(--bg))_94%,var(--text))] px-[0.45rem] py-[0.35rem] font-mono text-[0.7rem] leading-[1.35]"
              >{suggestionGlobs.join('\n')}</pre>
            </details>
          {:else}
            <p class="drive-suggest-hint-muted m-0 text-[0.8rem] italic leading-[1.42] text-muted">
              Suggested file skips are already in your ignore list.
            </p>
          {/if}
        {/if}
        <div class="drive-suggest-footer flex flex-wrap gap-2">
          <button
            type="button"
            class={cn(hubDialogBtnBase, hubDialogBtnPrimary, driveActionBtn)}
            disabled={saveBusy || !canApplySuggestions}
            onclick={() => void applySuggestions()}
          >
            {#if saveBusy}
              <RefreshCw size={14} aria-hidden="true" class="drive-spin" />
              Applying…
            {:else if selectedCount > 0 && suggestionGlobsPending.length > 0}
              Apply · {selectedCount} folder{selectedCount !== 1 ? 's' : ''} and file skips
            {:else if selectedCount > 0}
              Apply {selectedCount} folder{selectedCount !== 1 ? 's' : ''}
            {:else if suggestionGlobsPending.length > 0}
              Apply file skips
            {:else}
              Apply
            {/if}
          </button>
          <button
            type="button"
            class={cn(hubDialogBtnBase, hubDialogBtnSecondary, driveActionBtn)}
            onclick={() => (suggestOpen = false)}
          >
            Dismiss
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Inline folder browser -->
  {#if browserOpen}
    <div
      class="drive-browser flex flex-col gap-[0.4rem] border border-[color-mix(in_srgb,var(--border)_75%,transparent)] bg-[color-mix(in_srgb,var(--bg-2,var(--bg))_80%,var(--bg))] px-3 py-[0.6rem]"
    >
      <div class="drive-browser-head flex items-center gap-[0.4rem]">
        <span
          class="drive-browser-breadcrumb inline-flex min-w-0 flex-1 flex-wrap items-center gap-[0.1rem]"
        >
          <button
            type="button"
            class="drive-bc-seg drive-bc-root cursor-pointer border-none bg-transparent px-[0.2rem] py-[0.1rem] text-[0.8rem] font-semibold text-muted hover:bg-[color-mix(in_srgb,var(--accent,#6366f1)_10%,transparent)]"
            onclick={() => { browserStack = []; void loadBrowser(undefined) }}
          >
            My Drive
          </button>
          {#each browserStack as seg, i (seg.id + i)}
            <ChevronRight size={13} class="drive-bc-sep" aria-hidden="true" />
            <button
              type="button"
              class="drive-bc-seg cursor-pointer border-none bg-transparent px-[0.2rem] py-[0.1rem] text-[0.8rem] font-semibold text-accent hover:bg-[color-mix(in_srgb,var(--accent,#6366f1)_10%,transparent)]"
              onclick={() => {
                const next = browserStack.slice(0, i + 1)
                browserStack = next
                void loadBrowser(next[next.length - 1].id)
              }}
            >{seg.name}</button>
          {/each}
        </span>
        <button
          type="button"
          class={cn(hubIconBtn, 'drive-browser-close shrink-0')}
          aria-label="Close folder browser"
          onclick={() => (browserOpen = false)}
        >
          <X size={14} />
        </button>
      </div>

      {#if browserLoading}
        <p class="drive-browser-note m-0 text-[0.8125rem] text-muted">Loading…</p>
      {:else if browserErr}
        <p class={driveErr} role="alert">{browserErr}</p>
      {:else if browserFolders.length === 0}
        <p class="drive-browser-note m-0 text-[0.8125rem] text-muted">No subfolders here.</p>
      {:else}
        <ul class="drive-browser-list m-0 list-none p-0">
          {#each browserFolders as f (f.id)}
            {@const alreadyAdded = roots.some((r) => r.id === f.id)}
            <li
              class="drive-browser-row flex items-center gap-[0.4rem] border-b border-[color-mix(in_srgb,var(--border)_50%,transparent)] py-1 last:border-b-0"
            >
              <button
                type="button"
                class="drive-browser-name flex flex-1 items-center gap-[0.35rem] border-none bg-transparent px-[0.3rem] py-[0.2rem] text-left text-sm text-inherit hover:enabled:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] disabled:cursor-default"
                disabled={!f.hasChildren}
                onclick={() => browserEnter(f)}
              >
                <Folder size={14} aria-hidden="true" class="drive-browser-folder-icon" />
                <span>{f.name}</span>
                {#if f.hasChildren}
                  <ChevronRight size={13} class="drive-browser-chevron" aria-hidden="true" />
                {/if}
              </button>
              <button
                type="button"
                class={cn(
                  hubDialogBtnBase,
                  alreadyAdded ? hubDialogBtnSecondary : hubDialogBtnPrimary,
                  'drive-browser-add shrink-0 px-[0.55rem] py-[0.2rem] text-[0.8rem]',
                )}
                disabled={alreadyAdded || saveBusy}
                onclick={() => addFolder(f)}
              >
                {alreadyAdded ? 'Added' : 'Add'}
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if browserStack.length > 0}
        <button
          type="button"
          class={cn(
            hubDialogBtnBase,
            hubDialogBtnSecondary,
            'drive-browser-up mt-1 self-start text-[0.8rem]',
          )}
          onclick={browserUp}
        >
          ← Up
        </button>
      {/if}
    </div>
  {/if}

  <!-- Advanced settings -->
  {#if roots.length > 0 || advancedOpen}
    <div
      class="drive-advanced mt-1 flex flex-col border-t border-[color-mix(in_srgb,var(--border)_60%,transparent)] pt-2"
    >
      <button
        type="button"
        class="drive-advanced-toggle inline-flex cursor-pointer items-center gap-[0.3rem] self-start border-none bg-transparent p-0 text-[0.8125rem] font-semibold text-muted hover:text-foreground"
        onclick={() => (advancedOpen = !advancedOpen)}
        aria-expanded={advancedOpen}
      >
        {#if advancedOpen}
          <ChevronDown size={13} aria-hidden="true" />
        {:else}
          <ChevronRight size={13} aria-hidden="true" />
        {/if}
        Advanced
      </button>

      {#if advancedOpen}
        <div class="drive-advanced-body mt-[0.6rem] flex flex-col gap-[0.6rem]">
          <!-- Shared with me toggle -->
          <div class="drive-adv-row flex items-center justify-between gap-2">
            <span class="drive-adv-label text-[0.8rem] font-medium text-muted">Shared with me</span>
            <button
              type="button"
              class={cn(
                'drive-toggle relative h-5 w-9 shrink-0 cursor-pointer border-none p-0 transition-colors duration-150',
                sharedWithMe
                  ? 'drive-toggle--on bg-accent'
                  : 'bg-[color-mix(in_srgb,var(--text)_18%,transparent)]',
              )}
              role="switch"
              aria-checked={sharedWithMe}
              aria-label="Shared with me"
              onclick={() => void toggleSharedWithMe()}
            >
              <span
                class={cn(
                  'drive-toggle-thumb absolute left-[0.15rem] top-[0.15rem] h-[0.95rem] w-[0.95rem] bg-white shadow-[0_1px_2px_rgb(0_0_0/18%)] transition-transform duration-150',
                  sharedWithMe && 'translate-x-4',
                )}
              ></span>
            </button>
          </div>

          <!-- Ignore patterns -->
          <label class="drive-adv-field flex flex-col gap-1">
            <span class="drive-adv-label text-[0.8rem] font-medium text-muted">
              Ignore patterns (one per line)
            </span>
            <textarea
              class="hub-source-textarea drive-adv-textarea resize-y border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface px-2 py-1.5 text-[0.8rem] text-foreground"
              rows={3}
              value={ignoreText}
              oninput={onIgnoreTextInput}
              placeholder="*.tmp&#10;~$*&#10;.DS_Store"
            ></textarea>
          </label>

          <!-- Max file size -->
          <label class="drive-adv-field flex flex-col gap-1">
            <span class="drive-adv-label text-[0.8rem] font-medium text-muted">
              Max file size (MB)
            </span>
            <input
              type="number"
              class="hub-source-input drive-adv-input max-w-28 border border-[color-mix(in_srgb,var(--border)_80%,transparent)] bg-surface px-2 py-1.5 text-sm text-foreground"
              min={1}
              step={1}
              value={maxFileMb}
              oninput={onMaxMbInput}
            />
          </label>

          {#if advancedDirty}
            <div class="drive-adv-save-row flex">
              <button
                type="button"
                class={cn(hubDialogBtnBase, hubDialogBtnPrimary, driveActionBtn)}
                disabled={saveBusy}
                onclick={() => void saveAdvanced()}
              >
                {saveBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  /* Lucide icon classes used via the component's `class` prop are global by nature. */
  :global(.drive-bc-sep) {
    opacity: 0.45;
    flex-shrink: 0;
  }

  :global(.drive-browser-folder-icon) {
    flex-shrink: 0;
    color: var(--text-2);
  }

  :global(.drive-browser-chevron) {
    flex-shrink: 0;
    opacity: 0.5;
    margin-left: auto;
  }

  /* Spinner — referenced via `class="drive-spin"` on Lucide RefreshCw inside this file. */
  :global(.drive-spin) {
    animation: drive-spin 1s linear infinite;
  }

  @keyframes drive-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
