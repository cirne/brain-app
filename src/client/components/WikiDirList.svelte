<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import { ChevronRight, FileText, Folder } from '@lucide/svelte'
  import { cn } from '@client/lib/cn.js'
  import type { SurfaceContext } from '@client/router.js'
  import {
    listWikiDirChildren,
    normalizeWikiDirPath,
    type WikiDirListEntry,
    type WikiFileRow,
  } from '@client/lib/wikiDirListModel.js'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import { getWikiSlideHeaderCell } from '@client/lib/wikiSlideHeaderContext.js'
  import { t } from '@client/lib/i18n/index.js'

  let {
    dirPath: dirPathProp,
    refreshKey = 0,
    onOpenFile,
    onOpenDir,
    onContextChange,
  }: {
    dirPath?: string
    refreshKey?: number
    onOpenFile: (_path: string) => void
    onOpenDir: (_path: string) => void
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  const dirPath = $derived(normalizeWikiDirPath(dirPathProp))

  let files = $state<WikiFileRow[]>([])
  let loading = $state(true)
  let loadError = $state(false)

  const entries = $derived(listWikiDirChildren(files, dirPathProp))

  const wikiHeaderCell = getWikiSlideHeaderCell()

  function wikiDirSlideSetPageModeNoop() {
    /* view-only directory list */
  }

  const wikiHeaderCtrl = wikiHeaderCell?.claim({
    pageMode: 'view',
    canEdit: false,
    saveState: 'idle',
    setPageMode: wikiDirSlideSetPageModeNoop,
  })

  async function loadFiles() {
    loading = true
    loadError = false
    try {
      const res = await fetch('/api/wiki')
      if (!res.ok) throw new Error('bad status')
      const data: unknown = await res.json()
      files = parseWikiListApiBody(data).files
    } catch {
      files = []
      loadError = true
    } finally {
      loading = false
    }
  }

  function onEntryClick(entry: WikiDirListEntry) {
    if (entry.kind === 'dir') {
      onOpenDir(entry.path)
      return
    }
    onOpenFile(entry.path)
  }

  $effect(() => {
    void refreshKey
    void loadFiles()
  })

  $effect(() => {
    const d = dirPath
    const label = d ? (d.split('/').pop() ?? d) : $t('nav.wiki.label')
    untrack(() => onContextChange?.({ type: 'wiki-dir', path: d, title: label }))
  })

  onDestroy(() => {
    wikiHeaderCtrl?.clear()
    untrack(() => onContextChange?.({ type: 'none' }))
  })
</script>

<div class="wiki-dir flex min-h-0 flex-1 flex-col overflow-hidden">
  <div
    class="wiki-dir-inner mx-auto box-border w-full max-w-chat min-h-0 flex-1 overflow-y-auto px-[clamp(1rem,4%,2.5rem)] py-6"
  >
    {#if loading}
      <p class="status m-0 text-sm text-muted">{$t('common.status.loading')}</p>
    {:else if loadError}
      <p class="status status-err m-0 text-sm text-[var(--text-3,var(--text-2))]">{$t('wiki.dirList.loadError')}</p>
    {:else if entries.length === 0}
      <p class="status m-0 text-sm text-muted">{$t('wiki.dirList.emptyFolder')}</p>
    {:else}
      <ul
        class="wiki-dir-list m-0 flex list-none flex-col gap-0 p-0"
        aria-label={dirPath
          ? $t('wiki.dirList.pagesInPathAria', { path: dirPath })
          : $t('wiki.dirList.wikiPagesAria')}
      >
        {#each entries as entry (`${entry.kind}:${entry.path}`)}
          <li>
            <button
              type="button"
              class={cn(
                'wiki-dir-row group grid w-full cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-x-3.5 gap-y-3 border-0 border-b border-[color-mix(in_srgb,var(--border)_45%,transparent)] bg-transparent px-0 py-3 text-left text-foreground text-[0.9375rem] transition-colors duration-150 hover:bg-surface-2 hover:text-accent',
              )}
              onclick={() => onEntryClick(entry)}
            >
              <span class="wiki-dir-icon flex shrink-0 text-muted" aria-hidden="true">
                {#if entry.kind === 'dir'}
                  <Folder size={18} />
                {:else}
                  <FileText size={18} />
                {/if}
              </span>
              <span class="wiki-dir-label min-w-0 font-semibold [word-break:break-word]">{entry.label}</span>
              <span
                class="wiki-dir-chevron flex shrink-0 text-[var(--text-3,var(--text-2))] group-hover:text-accent"
                aria-hidden="true"
              ><ChevronRight size={18} /></span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
