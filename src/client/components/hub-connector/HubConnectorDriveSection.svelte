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

  // Advanced section open/close
  let advancedOpen = $state(false)

  // Text for globs textarea
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
      // Pre-select folders the LLM recommends including
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
    // Merge suggested folders (not already in roots) that are selected
    const toAdd = suggestions
      .filter((s) => suggestSelected.has(s.id) && !roots.some((r) => r.id === s.id))
      .map((s) => ({ id: s.id, name: s.name, recursive: true }))
    const next = [...roots, ...toAdd]
    // Merge globs: add suggestion globs not already present
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
</script>

<section class="drive-section" aria-labelledby="drive-folders-heading">
  <h2 id="drive-folders-heading" class="drive-heading">Folders</h2>

  {#if saveErr}
    <p class="drive-err" role="alert">{saveErr}</p>
  {/if}

  <!-- ── Empty state ── -->
  {#if roots.length === 0 && !suggestOpen && !browserOpen}
    <p class="drive-empty-hint">
      Choose which Drive folders Braintunnel indexes. Braintunnel requires at least one folder.
    </p>
    <div class="drive-empty-ctas">
      <button
        type="button"
        class="hub-dialog-btn hub-dialog-btn-primary drive-cta-btn"
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
        class="hub-dialog-btn hub-dialog-btn-secondary drive-cta-btn"
        onclick={openBrowser}
      >
        <Folder size={15} aria-hidden="true" />
        Browse folders
      </button>
    </div>
    {#if suggestErr}
      <p class="drive-err" role="alert">{suggestErr}</p>
    {/if}

  {:else}
    <!-- ── Folder cards ── -->
    {#if roots.length > 0}
      <ul class="drive-folder-list" role="list">
        {#each roots as root, i (root.id)}
          <li class="drive-folder-card">
            <span class="drive-folder-icon" aria-hidden="true">
              <Folder size={16} />
            </span>
            <span class="drive-folder-name">{root.name}</span>
            <label class="drive-subfolder-toggle" title="Include subfolders">
              <input
                type="checkbox"
                checked={root.recursive}
                onchange={(e) => setRecursive(i, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span class="drive-subfolder-label">Subfolders</span>
            </label>
            <button
              type="button"
              class="hub-icon-btn drive-remove-btn"
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

    <!-- ── Add folder / Suggest row ── -->
    {#if !browserOpen && !suggestOpen}
      <div class="drive-actions-row">
        <button
          type="button"
          class="hub-dialog-btn hub-dialog-btn-secondary drive-action-btn"
          onclick={openBrowser}
        >
          <FolderOpen size={14} aria-hidden="true" />
          Add folder
        </button>
        <button
          type="button"
          class="hub-dialog-btn hub-dialog-btn-secondary drive-action-btn"
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
        <p class="drive-err" role="alert">{suggestErr}</p>
      {/if}
    {/if}
  {/if}

  <!-- ── AI suggestion panel ── -->
  {#if suggestOpen}
    <div class="drive-suggest-panel">
      <div class="drive-suggest-header">
        <Sparkles size={14} aria-hidden="true" />
        <span class="drive-suggest-title">Suggested folders</span>
        <button
          type="button"
          class="hub-icon-btn drive-suggest-close"
          aria-label="Dismiss suggestions"
          onclick={() => (suggestOpen = false)}
        >
          <X size={14} />
        </button>
      </div>
      {#if suggestions.length === 0}
        <p class="drive-suggest-empty">No folders found in your Drive to suggest.</p>
      {:else}
        <ul class="drive-suggest-list" role="list">
          {#each suggestions as s (s.id)}
            {@const checked = suggestSelected.has(s.id)}
            {@const alreadyAdded = roots.some((r) => r.id === s.id)}
            <li
              class="drive-suggest-row"
              class:drive-suggest-row--skip={!alreadyAdded && !checked}
              class:drive-suggest-row--inactive={alreadyAdded}
            >
              <label class="drive-suggest-label" class:drive-suggest-label--inactive={alreadyAdded}>
                <input
                  type="checkbox"
                  class="drive-suggest-sr-input"
                  checked={checked}
                  disabled={alreadyAdded}
                  aria-label={alreadyAdded
                    ? `${s.name}, already in your folders`
                    : `${checked ? 'Deselect' : 'Select'} ${s.name}`}
                  onchange={() => toggleSuggestion(s.id)}
                />
                <span class="drive-suggest-check" aria-hidden="true">
                  {#if alreadyAdded}
                    <span class="drive-suggest-marker drive-suggest-marker--added">
                      <Check size={12} aria-hidden="true" strokeWidth={2.5} />
                    </span>
                  {:else if checked}
                    <span class="drive-suggest-marker drive-suggest-marker--on">✓</span>
                  {:else}
                    <span class="drive-suggest-marker drive-suggest-marker--off"></span>
                  {/if}
                </span>
                <span class="drive-suggest-info">
                  <span class="drive-suggest-folder-name">{s.name}</span>
                  {#if s.reason}
                    <span class="drive-suggest-reason">{s.reason}</span>
                  {/if}
                </span>
              </label>
            </li>
          {/each}
        </ul>
        {#if suggestionGlobs.length > 0}
          {#if suggestionGlobsPending.length > 0}
            {#if driveSuggestHumanSkipsLine}
              <p class="drive-suggest-hint">{driveSuggestHumanSkipsLine}</p>
            {/if}
            <details class="drive-suggest-details">
              <summary class="drive-suggest-details-summary">Technical patterns (optional)</summary>
              <p class="drive-suggest-details-note">
                These are merged into <strong>Ignore patterns</strong> under Advanced when you apply.
              </p>
              <pre class="drive-suggest-patterns">{suggestionGlobs.join('\n')}</pre>
            </details>
          {:else}
            <p class="drive-suggest-hint-muted">Suggested file skips are already in your ignore list.</p>
          {/if}
        {/if}
        <div class="drive-suggest-footer">
          <button
            type="button"
            class="hub-dialog-btn hub-dialog-btn-primary drive-action-btn"
            disabled={saveBusy || !canApplySuggestions}
            onclick={() => void applySuggestions()}
          >
            {#if saveBusy}
              <RefreshCw size={14} aria-hidden="true" class="drive-spin" />
              Applying…
            {:else}
              {#if selectedCount > 0 && suggestionGlobsPending.length > 0}
                Apply · {selectedCount} folder{selectedCount !== 1 ? 's' : ''} and file skips
              {:else if selectedCount > 0}
                Apply {selectedCount} folder{selectedCount !== 1 ? 's' : ''}
              {:else if suggestionGlobsPending.length > 0}
                Apply file skips
              {:else}
                Apply
              {/if}
            {/if}
          </button>
          <button
            type="button"
            class="hub-dialog-btn hub-dialog-btn-secondary drive-action-btn"
            onclick={() => (suggestOpen = false)}
          >
            Dismiss
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- ── Inline folder browser ── -->
  {#if browserOpen}
    <div class="drive-browser">
      <div class="drive-browser-head">
        <span class="drive-browser-breadcrumb">
          <button
            type="button"
            class="drive-bc-seg drive-bc-root"
            onclick={() => { browserStack = []; void loadBrowser(undefined) }}
          >
            My Drive
          </button>
          {#each browserStack as seg, i (seg.id + i)}
            <ChevronRight size={13} class="drive-bc-sep" aria-hidden="true" />
            <button
              type="button"
              class="drive-bc-seg"
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
          class="hub-icon-btn drive-browser-close"
          aria-label="Close folder browser"
          onclick={() => (browserOpen = false)}
        >
          <X size={14} />
        </button>
      </div>

      {#if browserLoading}
        <p class="drive-browser-note">Loading…</p>
      {:else if browserErr}
        <p class="drive-err" role="alert">{browserErr}</p>
      {:else if browserFolders.length === 0}
        <p class="drive-browser-note">No subfolders here.</p>
      {:else}
        <ul class="drive-browser-list">
          {#each browserFolders as f (f.id)}
            {@const alreadyAdded = roots.some((r) => r.id === f.id)}
            <li class="drive-browser-row">
              <button
                type="button"
                class="drive-browser-name"
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
                class="hub-dialog-btn drive-browser-add"
                class:hub-dialog-btn-primary={!alreadyAdded}
                class:hub-dialog-btn-secondary={alreadyAdded}
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
          class="hub-dialog-btn hub-dialog-btn-secondary drive-browser-up"
          onclick={browserUp}
        >
          ← Up
        </button>
      {/if}
    </div>
  {/if}

  <!-- ── Advanced settings ── -->
  {#if roots.length > 0 || advancedOpen}
    <div class="drive-advanced">
      <button
        type="button"
        class="drive-advanced-toggle"
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
        <div class="drive-advanced-body">
          <!-- Shared with me toggle -->
          <div class="drive-adv-row">
            <span class="drive-adv-label">Shared with me</span>
            <button
              type="button"
              class="drive-toggle"
              class:drive-toggle--on={sharedWithMe}
              role="switch"
              aria-checked={sharedWithMe}
              aria-label="Shared with me"
              onclick={() => void toggleSharedWithMe()}
            >
              <span class="drive-toggle-thumb"></span>
            </button>
          </div>

          <!-- Ignore patterns -->
          <label class="drive-adv-field">
            <span class="drive-adv-label">Ignore patterns (one per line)</span>
            <textarea
              class="hub-source-textarea drive-adv-textarea"
              rows={3}
              value={ignoreText}
              oninput={onIgnoreTextInput}
              placeholder="*.tmp&#10;~$*&#10;.DS_Store"
            ></textarea>
          </label>

          <!-- Max file size -->
          <label class="drive-adv-field">
            <span class="drive-adv-label">Max file size (MB)</span>
            <input
              type="number"
              class="hub-source-input drive-adv-input"
              min={1}
              step={1}
              value={maxFileMb}
              oninput={onMaxMbInput}
            />
          </label>

          {#if advancedDirty}
            <div class="drive-adv-save-row">
              <button
                type="button"
                class="hub-dialog-btn hub-dialog-btn-primary drive-action-btn"
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
  .drive-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.25rem;
  }

  .drive-heading {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    opacity: 0.85;
    margin: 0;
  }

  .drive-err {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--danger, #e11d48);
  }

  /* ── Empty state ── */
  .drive-empty-hint {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-2);
    line-height: 1.45;
  }

  .drive-empty-ctas {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .drive-cta-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  /* ── Folder cards ── */
  .drive-folder-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .drive-folder-card {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
border: 1px solid color-mix(in srgb, var(--border) 88%, transparent);
    background: color-mix(in srgb, var(--bg-2, var(--bg)) 94%, var(--text));
    min-height: 2.75rem;
    box-sizing: border-box;
  }

  .drive-folder-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    color: var(--text-2);
  }

  .drive-folder-name {
    flex: 1;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.015em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .drive-subfolder-toggle {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    cursor: pointer;
  }

  .drive-subfolder-label {
    font-size: 0.75rem;
    color: var(--text-2);
    white-space: nowrap;
  }

  .drive-remove-btn {
    flex-shrink: 0;
    color: var(--text-2);
  }

  .drive-remove-btn:hover {
    color: var(--danger, #e11d48);
  }

  /* ── Action buttons row ── */
  .drive-actions-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .drive-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8125rem;
  }

  /* ── AI suggestions panel ── */
  .drive-suggest-panel {
    border: 1px solid color-mix(in srgb, var(--accent, #6366f1) 30%, var(--border));
padding: 0.65rem 0.75rem;
    background: color-mix(in srgb, var(--accent, #6366f1) 5%, var(--bg));
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .drive-suggest-header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--accent, #6366f1);
  }

  .drive-suggest-title {
    flex: 1;
    font-size: 0.8125rem;
    font-weight: 600;
  }

  .drive-suggest-close {
    color: var(--text-2);
  }

  .drive-suggest-empty {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-2);
  }

  .drive-suggest-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .drive-suggest-row {
    padding: 0.35rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }

  .drive-suggest-row:last-child {
    border-bottom: none;
  }

  .drive-suggest-row--skip {
    opacity: 0.6;
  }

  .drive-suggest-row--inactive {
    opacity: 0.95;
  }

  .drive-suggest-label {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    cursor: pointer;
  }

  .drive-suggest-label--inactive {
    cursor: default;
  }

  .drive-suggest-sr-input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  .drive-suggest-check {
    flex-shrink: 0;
    width: 1.25rem;
    height: 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 0.1rem;
  }

  .drive-suggest-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
box-sizing: border-box;
    font-size: 0.75rem;
  }

  .drive-suggest-marker--on {
    background: var(--accent, #6366f1);
    color: white;
}

  .drive-suggest-marker--off {
    border: 2px solid color-mix(in srgb, var(--text) 26%, transparent);
  }

  .drive-suggest-marker--added {
    background: color-mix(in srgb, var(--text) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--border) 92%, transparent);
    color: var(--text-2);
  }

  .drive-suggest-info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .drive-suggest-folder-name {
    font-size: 0.9rem;
    font-weight: 600;
  }

  .drive-suggest-reason {
    font-size: 0.8rem;
    color: var(--text-2);
    line-height: 1.35;
  }

  .drive-suggest-hint {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-2);
    line-height: 1.42;
  }

  .drive-suggest-hint-muted {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-2);
    line-height: 1.42;
    font-style: italic;
  }

  .drive-suggest-details {
    font-size: 0.78rem;
    color: var(--text-2);
border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    padding: 0.35rem 0.5rem;
    background: color-mix(in srgb, var(--bg) 85%, var(--text));
  }

  .drive-suggest-details-summary {
    cursor: pointer;
    font-weight: 500;
    color: var(--text);
    user-select: none;
    list-style-position: outside;
    padding-inline: 0.1rem;
  }

  .drive-suggest-details-note {
    margin: 0.35rem 0 0;
    font-size: 0.76rem;
    line-height: 1.38;
    color: var(--text-2);
  }

  .drive-suggest-patterns {
    margin: 0.45rem 0 0;
    padding: 0.35rem 0.45rem;
    font-family: var(--font-mono, monospace);
    font-size: 0.7rem;
    line-height: 1.35;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 9rem;
    overflow: auto;
background: color-mix(in srgb, var(--bg-2, var(--bg)) 94%, var(--text));
    border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  }

  .drive-suggest-footer {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  /* ── Folder browser ── */
  .drive-browser {
    border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
padding: 0.6rem 0.75rem;
    background: color-mix(in srgb, var(--bg-2, var(--bg)) 80%, var(--bg));
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .drive-browser-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .drive-browser-breadcrumb {
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .drive-bc-seg {
    background: none;
    border: none;
    color: var(--accent, #6366f1);
    cursor: pointer;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.1rem 0.2rem;
}

  .drive-bc-seg:hover {
    background: color-mix(in srgb, var(--accent, #6366f1) 10%, transparent);
  }

  .drive-bc-root {
    color: var(--text-2);
  }

  :global(.drive-bc-sep) {
    opacity: 0.45;
    flex-shrink: 0;
  }

  .drive-browser-close {
    flex-shrink: 0;
    color: var(--text-2);
  }

  .drive-browser-note {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-2);
  }

  .drive-browser-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .drive-browser-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }

  .drive-browser-row:last-child {
    border-bottom: none;
  }

  .drive-browser-name {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 0.875rem;
    padding: 0.2rem 0.3rem;
text-align: left;
  }

  .drive-browser-name:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text) 6%, transparent);
  }

  .drive-browser-name:disabled {
    cursor: default;
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

  .drive-browser-add {
    flex-shrink: 0;
    padding: 0.2rem 0.55rem;
    font-size: 0.8rem;
  }

  .drive-browser-up {
    align-self: flex-start;
    font-size: 0.8rem;
    margin-top: 0.25rem;
  }

  /* ── Advanced settings ── */
  .drive-advanced {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    padding-top: 0.5rem;
    margin-top: 0.25rem;
  }

  .drive-advanced-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: none;
    border: none;
    color: var(--text-2);
    cursor: pointer;
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0;
    align-self: flex-start;
  }

  .drive-advanced-toggle:hover {
    color: var(--text);
  }

  .drive-advanced-body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.6rem;
  }

  .drive-adv-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .drive-adv-label {
    font-size: 0.8rem;
    color: var(--text-2);
    font-weight: 500;
  }

  .drive-adv-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .drive-adv-textarea {
    font-size: 0.8rem;
    resize: vertical;
  }

  .drive-adv-input {
    max-width: 7rem;
  }

  .drive-adv-save-row {
    display: flex;
  }

  /* ── Toggle switch ── */
  .drive-toggle {
    position: relative;
    width: 2.25rem;
    height: 1.25rem;
border: none;
    cursor: pointer;
    padding: 0;
    background: color-mix(in srgb, var(--text) 18%, transparent);
    transition: background 0.15s;
    flex-shrink: 0;
  }

  .drive-toggle--on {
    background: var(--accent, #6366f1);
  }

  .drive-toggle-thumb {
    position: absolute;
    top: 0.15rem;
    left: 0.15rem;
    width: 0.95rem;
    height: 0.95rem;
background: white;
    transition: transform 0.15s;
    box-shadow: 0 1px 2px rgb(0 0 0 / 18%);
  }

  .drive-toggle--on .drive-toggle-thumb {
    transform: translateX(1rem);
  }

  /* ── Spinner animation ── */
  :global(.drive-spin) {
    animation: drive-spin 1s linear infinite;
  }

  @keyframes drive-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
