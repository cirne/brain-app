<script lang="ts">
  import { ChevronRight, FolderPlus, Trash2 } from 'lucide-svelte'

  export type HubFileSourceRoot = {
    id: string
    name: string
    recursive: boolean
  }

  export type HubFileSourceConfig = {
    roots: HubFileSourceRoot[]
    includeGlobs: string[]
    ignoreGlobs: string[]
    maxFileBytes: number
    respectGitignore: boolean
  }

  type Props = {
    sourceId: string
    sourceKind: 'localDir' | 'googleDrive'
    fileSource: HubFileSourceConfig | null
    onSaved: () => void
  }

  let { sourceId, sourceKind, fileSource, onSaved }: Props = $props()

  function blankConfig(): HubFileSourceConfig {
    return {
      roots: [],
      includeGlobs: [],
      ignoreGlobs: [],
      maxFileBytes: 10_000_000,
      respectGitignore: true,
    }
  }

  function cloneCfg(c: HubFileSourceConfig): HubFileSourceConfig {
    return {
      roots: c.roots.map((r) => ({ ...r })),
      includeGlobs: [...c.includeGlobs],
      ignoreGlobs: [...c.ignoreGlobs],
      maxFileBytes: c.maxFileBytes,
      respectGitignore: c.respectGitignore,
    }
  }

  let draft = $state<HubFileSourceConfig>(blankConfig())
  let saveBusy = $state(false)
  let saveErr = $state<string | null>(null)
  let globsOpen = $state(false)

  let browserOpen = $state(false)
  let browserLoading = $state(false)
  let browserErr = $state<string | null>(null)
  let browserFolders = $state<{ id: string; name: string; hasChildren: boolean }[]>([])
  let browserStack = $state<{ id: string; name: string }[]>([])

  $effect.pre(() => {
    void sourceId
    void sourceKind
    draft = cloneCfg(fileSource ?? blankConfig())
  })

  let includeText = $state('')
  let ignoreText = $state('')

  $effect(() => {
    includeText = draft.includeGlobs.join('\n')
    ignoreText = draft.ignoreGlobs.join('\n')
  })

  function syncGlobsFromText() {
    draft.includeGlobs = includeText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    draft.ignoreGlobs = ignoreText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  }

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

  function browserEnter(folder: { id: string; name: string }) {
    browserStack = [...browserStack, folder]
    void loadBrowser(folder.id)
  }

  function browserUp() {
    if (browserStack.length === 0) return
    const next = browserStack.slice(0, -1)
    browserStack = next
    const parent = next.length ? next[next.length - 1].id : undefined
    void loadBrowser(parent)
  }

  function pickFolder(f: { id: string; name: string }) {
    syncGlobsFromText()
    if (draft.roots.some((r) => r.id === f.id)) {
      browserOpen = false
      return
    }
    draft.roots = [...draft.roots, { id: f.id, name: f.name, recursive: true }]
    browserOpen = false
  }

  function removeRoot(i: number) {
    draft.roots = draft.roots.filter((_, j) => j !== i)
  }

  function setRecursive(i: number, v: boolean) {
    const roots = draft.roots.slice()
    roots[i] = { ...roots[i], recursive: v }
    draft.roots = roots
  }

  async function save() {
    syncGlobsFromText()
    saveBusy = true
    saveErr = null
    try {
      const res = await fetch('/api/hub/sources/update-file-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sourceId, fileSource: draft }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !j.ok) throw new Error(j.error || 'Save failed')
      onSaved()
    } catch (e) {
      saveErr = e instanceof Error ? e.message : String(e)
    } finally {
      saveBusy = false
    }
  }

  const driveNeedsFolders = $derived(sourceKind === 'googleDrive' && draft.roots.length === 0)
</script>

<div class="fs-editor">
  {#if driveNeedsFolders}
    <p class="fs-editor-warn" role="alert">
      No Drive folders selected — add at least one folder before syncing (entire-Drive sync is disabled).
    </p>
  {/if}
  {#if saveErr}
    <p class="fs-editor-err" role="alert">{saveErr}</p>
  {/if}
  {#if browserErr}
    <p class="fs-editor-err" role="alert">{browserErr}</p>
  {/if}

  <div class="fs-editor-roots">
    <div class="fs-editor-roots-head">
      <span class="fs-editor-label">Indexed folders</span>
      <button type="button" class="hub-dialog-btn hub-dialog-btn-secondary fs-btn" onclick={openBrowser}>
        <FolderPlus size={16} aria-hidden="true" />
        Add folder…
      </button>
    </div>
    {#if draft.roots.length === 0}
      <p class="fs-editor-empty">None yet — use “Add folder…”.</p>
    {:else}
      <ul class="fs-root-list">
        {#each draft.roots as r, i (r.id + i)}
          <li class="fs-root-row">
            <div class="fs-root-main">
              <span class="fs-root-name">{r.name}</span>
              <code class="hub-source-code fs-root-id">{r.id}</code>
            </div>
            <label class="fs-rec-label">
              <input
                type="checkbox"
                checked={r.recursive}
                onchange={(e) => setRecursive(i, (e.currentTarget as HTMLInputElement).checked)}
              />
              Include subfolders
            </label>
            <button
              type="button"
              class="hub-icon-btn fs-remove"
              aria-label="Remove folder"
              onclick={() => removeRoot(i)}
            >
              <Trash2 size={16} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if browserOpen}
    <div class="fs-browser" role="dialog" aria-label="Pick folder">
      <div class="fs-browser-head">
        <button
          type="button"
          class="hub-dialog-btn hub-dialog-btn-secondary"
          onclick={browserUp}
          disabled={browserStack.length === 0}
        >
          Up
        </button>
        <span class="fs-breadcrumb">
          {#each browserStack as seg, i (seg.id + i)}
            <ChevronRight size={14} class="fs-bc-sep" aria-hidden="true" />
            <span>{seg.name}</span>
          {/each}
        </span>
        <button type="button" class="hub-dialog-btn hub-dialog-btn-secondary" onclick={() => (browserOpen = false)}>
          Close
        </button>
      </div>
      {#if browserLoading}
        <p class="fs-editor-note">Loading…</p>
      {:else if browserFolders.length === 0}
        <p class="fs-editor-note">No subfolders here.</p>
      {:else}
        <ul class="fs-browser-list">
          {#each browserFolders as f (f.id)}
            <li class="fs-browser-row">
              <button type="button" class="fs-browser-name" onclick={() => browserEnter(f)}>
                {f.name}
                {#if f.hasChildren}<span class="fs-has-kids">▸</span>{/if}
              </button>
              <button type="button" class="hub-dialog-btn hub-dialog-btn-primary fs-pick" onclick={() => pickFolder(f)}>
                Add
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <label class="fs-field">
    <span class="fs-editor-label">Max file bytes</span>
    <input
      type="number"
      class="hub-source-input"
      min="1"
      step="1"
      value={draft.maxFileBytes}
      oninput={(e) => {
        const v = Number((e.currentTarget as HTMLInputElement).value)
        if (Number.isFinite(v) && v > 0) draft.maxFileBytes = Math.floor(v)
      }}
    />
  </label>

  {#if sourceKind === 'localDir'}
    <label class="fs-check">
      <input type="checkbox" bind:checked={draft.respectGitignore} />
      Respect .gitignore
    </label>
  {/if}

  <button
    type="button"
    class="hub-dialog-btn hub-dialog-btn-secondary fs-globs-toggle"
    onclick={() => (globsOpen = !globsOpen)}
  >
    {globsOpen ? 'Hide' : 'Edit'} include / ignore patterns
  </button>
  {#if globsOpen}
    <label class="fs-field">
      <span class="fs-editor-label">Include globs (one per line, optional)</span>
      <textarea class="hub-source-textarea" rows="3" bind:value={includeText}></textarea>
    </label>
    <label class="fs-field">
      <span class="fs-editor-label">Ignore globs (one per line)</span>
      <textarea class="hub-source-textarea" rows="3" bind:value={ignoreText}></textarea>
    </label>
  {/if}

  <div class="fs-editor-actions">
    <button type="button" class="hub-dialog-btn hub-dialog-btn-primary" disabled={saveBusy} onclick={() => void save()}>
      {saveBusy ? 'Saving…' : 'Save file source settings'}
    </button>
  </div>
</div>

<style>
  .fs-editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  .fs-editor-warn {
    margin: 0;
    padding: 0.5rem 0.65rem;
    border-radius: 6px;
    background: color-mix(in srgb, orange 18%, transparent);
    font-size: 0.875rem;
  }
  .fs-editor-err {
    margin: 0;
    color: var(--color-danger, #c23);
    font-size: 0.875rem;
  }
  .fs-editor-note {
    margin: 0.25rem 0;
    font-size: 0.875rem;
    opacity: 0.85;
  }
  .fs-editor-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    opacity: 0.85;
  }
  .fs-editor-roots-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .fs-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .fs-editor-empty {
    margin: 0;
    font-size: 0.875rem;
    opacity: 0.8;
  }
  .fs-root-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .fs-root-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.45rem 0.5rem;
    border-radius: 6px;
    background: color-mix(in srgb, var(--color-fg, #ccc) 6%, transparent);
  }
  .fs-root-main {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .fs-root-name {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .fs-root-id {
    font-size: 0.7rem;
    word-break: break-all;
  }
  .fs-rec-label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .fs-remove {
    justify-self: end;
  }
  .fs-browser {
    border: 1px solid color-mix(in srgb, var(--color-fg, #ccc) 18%, transparent);
    border-radius: 8px;
    padding: 0.5rem;
    background: color-mix(in srgb, var(--color-fg, #ccc) 4%, transparent);
  }
  .fs-browser-head {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-bottom: 0.35rem;
  }
  .fs-breadcrumb {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    flex: 1;
    font-size: 0.8rem;
    opacity: 0.9;
    min-width: 0;
    flex-wrap: wrap;
  }
  :global(.fs-bc-sep) {
    opacity: 0.45;
  }
  .fs-browser-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .fs-browser-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    padding: 0.25rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--color-fg, #ccc) 8%, transparent);
  }
  .fs-browser-row:last-child {
    border-bottom: none;
  }
  .fs-browser-name {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    padding: 0.2rem;
    border-radius: 4px;
  }
  .fs-browser-name:hover {
    background: color-mix(in srgb, var(--color-fg, #ccc) 8%, transparent);
  }
  .fs-has-kids {
    margin-left: 0.25rem;
    opacity: 0.6;
  }
  .fs-pick {
    flex-shrink: 0;
    padding: 0.2rem 0.55rem;
    font-size: 0.8rem;
  }
  .fs-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .fs-check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.875rem;
  }
  .fs-globs-toggle {
    align-self: flex-start;
  }
  .fs-editor-actions {
    margin-top: 0.25rem;
  }
</style>
