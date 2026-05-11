<script lang="ts">
  import { ChevronRight, FolderPlus, Trash2 } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { t } from '@client/lib/i18n/index.js'

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
      if (!res.ok || !j.ok) throw new Error(j.error || $t('hub.fileSourceConfigEditor.errors.couldNotListFolders'))
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
      if (!res.ok || !j.ok) throw new Error(j.error || $t('hub.fileSourceConfigEditor.errors.saveFailed'))
      onSaved()
    } catch (e) {
      saveErr = e instanceof Error ? e.message : String(e)
    } finally {
      saveBusy = false
    }
  }

  const driveNeedsFolders = $derived(sourceKind === 'googleDrive' && draft.roots.length === 0)

  const btnPrimary = 'bt-btn bt-btn-primary'
  const btnSecondary = 'bt-btn bt-btn-secondary'
</script>

<div class="fs-editor mt-2 flex flex-col gap-3">
  {#if driveNeedsFolders}
    <p
      class="fs-editor-warn m-0 bg-[color-mix(in_srgb,orange_18%,transparent)] px-[0.65rem] py-2 text-sm"
      role="alert"
    >
      {$t('hub.fileSourceConfigEditor.driveFoldersRequired')}
    </p>
  {/if}
  {#if saveErr}
    <p class="fs-editor-err m-0 text-sm text-[var(--color-danger,#c23)]" role="alert">{saveErr}</p>
  {/if}
  {#if browserErr}
    <p class="fs-editor-err m-0 text-sm text-[var(--color-danger,#c23)]" role="alert">{browserErr}</p>
  {/if}

  <div class="fs-editor-roots">
    <div class="fs-editor-roots-head flex flex-wrap items-center justify-between gap-2">
      <span class="fs-editor-label text-xs font-semibold uppercase tracking-[0.03em] opacity-85">
        {$t('hub.fileSourceConfigEditor.labels.indexedFolders')}
      </span>
      <button type="button" class={cn(btnSecondary, 'fs-btn')} onclick={openBrowser}>
        <FolderPlus size={16} aria-hidden="true" />
        {$t('hub.fileSourceConfigEditor.actions.addFolder')}
      </button>
    </div>
    {#if draft.roots.length === 0}
      <p class="fs-editor-empty m-0 text-sm opacity-80">{$t('hub.fileSourceConfigEditor.empty.noIndexedFolders')}</p>
    {:else}
      <ul class="fs-root-list m-0 flex list-none flex-col gap-2 p-0">
        {#each draft.roots as r, i (r.id + i)}
          <li
            class="fs-root-row grid grid-cols-[1fr_auto_auto] items-center gap-2 bg-[color-mix(in_srgb,var(--color-fg,#ccc)_6%,transparent)] px-2 py-[0.45rem]"
          >
            <div class="fs-root-main flex min-w-0 flex-col gap-[0.15rem]">
              <span class="fs-root-name text-[0.9rem] font-semibold">{r.name}</span>
              <code class="hub-source-code fs-root-id text-[0.7rem] [word-break:break-all]">{r.id}</code>
            </div>
            <label class="fs-rec-label flex items-center gap-[0.35rem] whitespace-nowrap text-[0.8rem]">
              <input
                type="checkbox"
                checked={r.recursive}
                onchange={(e) => setRecursive(i, (e.currentTarget as HTMLInputElement).checked)}
              />
              {$t('hub.fileSourceConfigEditor.labels.includeSubfolders')}
            </label>
            <button
              type="button"
              class="hub-icon-btn fs-remove justify-self-end"
              aria-label={$t('hub.fileSourceConfigEditor.actions.removeFolderAria')}
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
    <div
      class="fs-browser border border-[color-mix(in_srgb,var(--color-fg,#ccc)_18%,transparent)] bg-[color-mix(in_srgb,var(--color-fg,#ccc)_4%,transparent)] p-2"
      role="dialog"
      aria-label={$t('hub.fileSourceConfigEditor.aria.pickFolder')}
    >
      <div class="fs-browser-head mb-[0.35rem] flex flex-wrap items-center gap-[0.35rem]">
        <button
          type="button"
          class={cn(btnSecondary)}
          onclick={browserUp}
          disabled={browserStack.length === 0}
        >
          {$t('hub.hubConnectorDriveSection.browser.up')}
        </button>
        <span
          class="fs-breadcrumb inline-flex min-w-0 flex-1 flex-wrap items-center gap-[0.15rem] text-[0.8rem] opacity-90"
        >
          {#each browserStack as seg, i (seg.id + i)}
            <ChevronRight size={14} class="fs-bc-sep" aria-hidden="true" />
            <span>{seg.name}</span>
          {/each}
        </span>
        <button type="button" class={cn(btnSecondary)} onclick={() => (browserOpen = false)}>
          {$t('common.actions.close')}
        </button>
      </div>
      {#if browserLoading}
        <p class="fs-editor-note my-1 text-sm opacity-85">{$t('common.status.loading')}</p>
      {:else if browserFolders.length === 0}
        <p class="fs-editor-note my-1 text-sm opacity-85">{$t('hub.hubConnectorDriveSection.browser.noSubfolders')}</p>
      {:else}
        <ul class="fs-browser-list m-0 list-none p-0">
          {#each browserFolders as f (f.id)}
            <li
              class="fs-browser-row flex items-center justify-between gap-[0.35rem] border-b border-[color-mix(in_srgb,var(--color-fg,#ccc)_8%,transparent)] py-1 last:border-b-0"
            >
              <button
                type="button"
                class="fs-browser-name flex-1 cursor-pointer border-none bg-none p-1 text-left text-inherit [font:inherit] hover:bg-[color-mix(in_srgb,var(--color-fg,#ccc)_8%,transparent)]"
                onclick={() => browserEnter(f)}
              >
                {f.name}
                {#if f.hasChildren}<span class="fs-has-kids ml-1 opacity-60">▸</span>{/if}
              </button>
              <button type="button" class={cn(btnPrimary, 'fs-pick shrink-0 px-[0.55rem] py-[0.2rem] text-[0.8rem]')} onclick={() => pickFolder(f)}>
                {$t('hub.hubConnectorDriveSection.browser.add')}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  <label class="fs-field flex flex-col gap-1">
    <span class="fs-editor-label text-xs font-semibold uppercase tracking-[0.03em] opacity-85">
      {$t('hub.fileSourceConfigEditor.labels.maxFileBytes')}
    </span>
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
    <label class="fs-check flex items-center gap-[0.4rem] text-sm">
      <input type="checkbox" bind:checked={draft.respectGitignore} />
      {$t('hub.fileSourceConfigEditor.labels.respectGitignore')}
    </label>
  {/if}

  <button
    type="button"
    class={cn(btnSecondary, 'fs-globs-toggle self-start')}
    onclick={() => (globsOpen = !globsOpen)}
  >
    {globsOpen
      ? $t('hub.fileSourceConfigEditor.actions.hideIncludeIgnorePatterns')
      : $t('hub.fileSourceConfigEditor.actions.editIncludeIgnorePatterns')}
  </button>
  {#if globsOpen}
    <label class="fs-field flex flex-col gap-1">
      <span class="fs-editor-label text-xs font-semibold uppercase tracking-[0.03em] opacity-85">
        {$t('hub.fileSourceConfigEditor.labels.includeGlobs')}
      </span>
      <textarea class="hub-source-textarea" rows="3" bind:value={includeText}></textarea>
    </label>
    <label class="fs-field flex flex-col gap-1">
      <span class="fs-editor-label text-xs font-semibold uppercase tracking-[0.03em] opacity-85">
        {$t('hub.fileSourceConfigEditor.labels.ignoreGlobs')}
      </span>
      <textarea class="hub-source-textarea" rows="3" bind:value={ignoreText}></textarea>
    </label>
  {/if}

  <div class="fs-editor-actions mt-1">
    <button type="button" class={cn(btnPrimary)} disabled={saveBusy} onclick={() => void save()}>
      {saveBusy
        ? $t('common.status.saving')
        : $t('hub.fileSourceConfigEditor.actions.saveFileSourceSettings')}
    </button>
  </div>
</div>

<style>
  /* Lucide icon class — must escape Svelte's scoped CSS so the icon class still applies. */
  :global(.fs-bc-sep) {
    opacity: 0.45;
  }
</style>
