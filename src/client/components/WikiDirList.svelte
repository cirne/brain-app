<script lang="ts">
  import { getContext } from 'svelte'
  import {
    ChevronRight,
    FileSymlink,
    FileText,
    Folder,
    FolderSymlink,
    Share2,
    Users,
  } from 'lucide-svelte'
  import type { SurfaceContext } from '@client/router.js'
  import {
    listWikiDirChildrenWithShares,
    normalizeWikiDirPath,
    isSharedNamespacePath,
    vaultPathHasOutgoingShare,
    vaultRelativeDirFromWikiBrowseDir,
    type WikiDirListEntry,
    type WikiFileRow,
    type WikiOwnedShareRef,
    type WikiReceivedShareRow,
  } from '@client/lib/wikiDirListModel.js'
  import WikiShareDialog from './WikiShareDialog.svelte'
  import { parseWikiListApiBody } from '@client/lib/wikiFileListResponse.js'
  import { WIKI_SLIDE_HEADER, type SetWikiSlideHeader } from '@client/lib/wikiSlideHeaderContext.js'

  let {
    dirPath: dirPathProp,
    refreshKey = 0,
    shareOwner,
    sharePrefix,
    shareHandle,
    onOpenFile,
    onOpenDir,
    onOpenSharedDir: _onOpenSharedDir,
    onOpenSharedFile: _onOpenSharedFile,
    onContextChange,
  }: {
    /** Wiki-relative directory (no slashes at ends). Empty = root. */
    dirPath?: string
    refreshKey?: number
    /** When set with sharePrefix, list is loaded from shared owner wiki. */
    shareOwner?: string
    sharePrefix?: string
    shareHandle?: string
    onOpenFile: (_path: string) => void
    onOpenDir: (_path: string) => void
    onOpenSharedDir?: (_p: { ownerId: string; sharePrefix: string; ownerHandle: string }) => void
    onOpenSharedFile?: (_p: { ownerId: string; sharePrefix: string; ownerHandle: string }) => void
    onContextChange?: (_ctx: SurfaceContext) => void
  } = $props()

  const dirPath = $derived(normalizeWikiDirPath(dirPathProp))
  const sharedMode = $derived(
    Boolean(
      shareHandle?.trim() ||
        (shareOwner?.trim() && sharePrefix?.trim()),
    ),
  )

  let files = $state<WikiFileRow[]>([])
  let receivedShares = $state<WikiReceivedShareRow[]>([])
  /** Paths you share with others (`GET /api/wiki` → `shares.owned`). */
  let ownedShares = $state<WikiOwnedShareRef[]>([])
  let loading = $state(true)
  let loadError = $state(false)
  let shareDialogOpen = $state(false)
  let shareDialogPrefix = $state('')
  let shareDialogTargetKind = $state<'dir' | 'file'>('dir')

  const entries = $derived(
    listWikiDirChildrenWithShares(files, dirPathProp, sharedMode ? null : receivedShares),
  )

  const canShareCurrentDir = $derived(
    Boolean(!sharedMode && dirPath.trim() && !isSharedNamespacePath(dirPath)),
  )

  const registerWikiHeader = getContext<SetWikiSlideHeader | undefined>(WIKI_SLIDE_HEADER)
  $effect(() => {
    registerWikiHeader?.({
      pageMode: 'view',
      canEdit: false,
      saveState: 'idle',
      setPageMode: () => {},
      canShare: canShareCurrentDir,
      onOpenShare: () => {
        shareDialogTargetKind = 'dir'
        const rel = vaultRelativeDirFromWikiBrowseDir(dirPathProp)
        shareDialogPrefix = rel ? `${rel}/` : ''
        shareDialogOpen = true
      },
      shareTargetLabel: dirPath.trim() || undefined,
      sharedIncoming: sharedMode,
    })
    return () => registerWikiHeader?.(null)
  })

  async function loadFiles() {
    loading = true
    loadError = false
    try {
      const sh = shareHandle?.trim()
      const so = shareOwner?.trim()
      const sp = sharePrefix?.trim()
      let url = '/api/wiki'
      if (sh) {
        url =
          sp && sp.length > 0
            ? `/api/wiki/shared-by-handle/${encodeURIComponent(sh)}?prefix=${encodeURIComponent(sp)}`
            : `/api/wiki/shared-by-handle/${encodeURIComponent(sh)}`
      } else if (so && sp) {
        url = `/api/wiki/shared/${encodeURIComponent(so)}?prefix=${encodeURIComponent(sp)}`
      }
      const res = await fetch(url)
      if (!res.ok) throw new Error('bad status')
      const data: unknown = await res.json()
      if (sharedMode) {
        files = parseWikiListApiBody(data).files
        receivedShares = []
        ownedShares = []
      } else if (url === '/api/wiki') {
        const { files: fl, shares } = parseWikiListApiBody(data)
        files = fl
        receivedShares = shares.received
        ownedShares = shares.owned
      } else {
        files = parseWikiListApiBody(data).files
        receivedShares = []
        ownedShares = []
      }
    } catch {
      files = []
      receivedShares = []
      ownedShares = []
      loadError = true
    } finally {
      loading = false
    }
  }

  function metaForEntry(entry: WikiDirListEntry): string {
    if (entry.kind === 'my-wiki-root') return 'Local'
    if (entry.kind === 'shared-owner') return 'Shared wiki'
    if (entry.kind === 'shared-dir' || entry.kind === 'shared-file') return 'Shared'
    if (sharedMode) {
      if (entry.kind === 'dir') return 'Shared folder'
      if (entry.kind === 'file') return 'Shared page'
    }
    if (entry.kind === 'dir') return entryHasOutgoingShare(entry) ? 'Sharing' : 'Folder'
    return entryHasOutgoingShare(entry) ? 'Sharing' : 'Page'
  }

  function entryHasOutgoingShare(entry: WikiDirListEntry): boolean {
    if (sharedMode) return false
    if (entry.kind !== 'dir' && entry.kind !== 'file') return false
    return vaultPathHasOutgoingShare(entry.path, ownedShares)
  }

  /** Synthetic rows or items listed while browsing someone else's wiki (`shareHandle` / legacy share). */
  function entryIsShared(entry: WikiDirListEntry): boolean {
    if (entry.kind === 'my-wiki-root') return false
    if (
      entry.kind === 'shared-owner' ||
      entry.kind === 'shared-dir' ||
      entry.kind === 'shared-file'
    ) {
      return true
    }
    return sharedMode
  }

  function entryIsFolderLike(entry: WikiDirListEntry): boolean {
    return (
      entry.kind === 'dir' ||
      entry.kind === 'my-wiki-root' ||
      entry.kind === 'shared-owner' ||
      entry.kind === 'shared-dir'
    )
  }

  function onEntryClick(entry: WikiDirListEntry) {
    if (entry.kind === 'dir' || entry.kind === 'my-wiki-root' || entry.kind === 'shared-owner') {
      onOpenDir(entry.path)
      return
    }
    if (entry.kind === 'file') {
      onOpenFile(entry.path)
      return
    }
    if (entry.kind === 'shared-dir') {
      _onOpenSharedDir?.({
        ownerId: entry.ownerId,
        sharePrefix: entry.sharePrefix,
        ownerHandle: entry.ownerHandle,
      })
      return
    }
    if (entry.kind === 'shared-file') {
      _onOpenSharedFile?.({
        ownerId: entry.ownerId,
        sharePrefix: entry.sharePrefix,
        ownerHandle: entry.ownerHandle,
      })
    }
  }

  $effect(() => {
    void refreshKey
    void shareOwner
    void sharePrefix
    void shareHandle
    void loadFiles()
  })

  $effect(() => {
    const label = dirPath ? (dirPath.split('/').pop() ?? dirPath) : 'Wiki'
    onContextChange?.({ type: 'wiki-dir', path: dirPath, title: label })
    return () => onContextChange?.({ type: 'none' })
  })
</script>

<div class="wiki-dir">
  <WikiShareDialog
    open={shareDialogOpen}
    pathPrefix={shareDialogPrefix}
    targetKind={shareDialogTargetKind}
    onDismiss={() => {
      shareDialogOpen = false
    }}
  />
  <div class="wiki-dir-inner">
    {#if loading}
      <p class="status">Loading…</p>
    {:else if loadError}
      <p class="status status-err">Could not load wiki file list.</p>
    {:else if entries.length === 0}
      <p class="status">No pages in this folder.</p>
    {:else}
      <ul class="wiki-dir-list" aria-label={dirPath ? `Pages in ${dirPath}` : 'Wiki pages'}>
        {#each entries as entry (`${entry.kind}:${'path' in entry ? entry.path : entry.kind}`)}
          <li>
            <button
              type="button"
              class="wiki-dir-row"
              class:wiki-dir-row--shared={entryIsShared(entry)}
              class:wiki-dir-row--outgoing={entryHasOutgoingShare(entry)}
              onclick={() => onEntryClick(entry)}
            >
              <span
                class="wiki-dir-icon"
                class:wiki-dir-icon--shared={entryIsShared(entry)}
                aria-hidden="true"
              >
                {#if entry.kind === 'my-wiki-root'}
                  <Folder size={18} />
                {:else if entry.kind === 'shared-owner'}
                  <Users size={18} />
                {:else if entryIsShared(entry) && entryIsFolderLike(entry)}
                  <FolderSymlink size={18} />
                {:else if entryIsShared(entry)}
                  <FileSymlink size={18} />
                {:else if entry.kind === 'dir'}
                  <span class="wiki-dir-icon-cluster">
                    <Folder size={18} />
                    {#if entryHasOutgoingShare(entry)}
                      <span class="wiki-dir-outgoing-badge" title="You are sharing this folder">
                        <Share2 size={11} strokeWidth={2.5} />
                      </span>
                    {/if}
                  </span>
                {:else}
                  <span class="wiki-dir-icon-cluster">
                    <FileText size={18} />
                    {#if entryHasOutgoingShare(entry)}
                      <span class="wiki-dir-outgoing-badge" title="You are sharing this page">
                        <Share2 size={11} strokeWidth={2.5} />
                      </span>
                    {/if}
                  </span>
                {/if}
              </span>
              <span class="wiki-dir-label">{entry.label}</span>
              <span class="wiki-dir-meta">{metaForEntry(entry)}</span>
              <span class="wiki-dir-chevron" aria-hidden="true"><ChevronRight size={18} /></span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .wiki-dir {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .wiki-dir-inner {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    padding: 24px clamp(16px, 4%, 40px);
    max-width: var(--chat-column-max);
    width: 100%;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .status {
    margin: 0;
    font-size: 14px;
    color: var(--text-2);
  }

  .status-err {
    color: var(--text-3);
  }

  .wiki-dir-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .wiki-dir-row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 12px 14px;
    width: 100%;
    padding: 12px 0;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    font-size: 0.9375rem;
    transition: padding-left 0.15s ease, color 0.12s;
  }

  .wiki-dir-row:hover {
    padding-left: 4px;
    color: var(--accent);
  }

  .wiki-dir-icon {
    display: flex;
    color: var(--text-2);
    flex-shrink: 0;
  }

  .wiki-dir-icon--shared {
    color: color-mix(in srgb, var(--accent) 82%, var(--text-2));
  }

  .wiki-dir-row--shared:hover .wiki-dir-icon--shared {
    color: var(--accent);
  }

  .wiki-dir-icon-cluster {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .wiki-dir-outgoing-badge {
    position: absolute;
    right: -7px;
    bottom: -5px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-elevated, var(--bg)) 92%, transparent);
    color: color-mix(in srgb, var(--accent) 85%, var(--text-2));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--border) 55%, transparent);
  }

  .wiki-dir-row--outgoing:hover .wiki-dir-outgoing-badge {
    color: var(--accent);
  }

  .wiki-dir-label {
    font-weight: 600;
    min-width: 0;
    word-break: break-word;
  }

  .wiki-dir-meta {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
    flex-shrink: 0;
  }

  .wiki-dir-chevron {
    flex-shrink: 0;
    color: var(--text-3);
    display: flex;
  }

  .wiki-dir-row:hover .wiki-dir-chevron {
    color: var(--accent);
  }
</style>
