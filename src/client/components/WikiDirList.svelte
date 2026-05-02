<script lang="ts">
  import { getContext } from 'svelte'
  import {
    ChevronRight,
    FileSymlink,
    FileText,
    Folder,
    FolderSymlink,
    Users,
  } from 'lucide-svelte'
  import type { SurfaceContext } from '@client/router.js'
  import {
    countOutgoingSharesForVaultPath,
    listWikiDirChildrenWithShares,
    normalizeWikiDirPath,
    isSharedNamespacePath,
    vaultRelativeDirFromWikiBrowseDir,
    withUnifiedPeerPrefixOnListEntries,
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

  const entries = $derived.by((): WikiDirListEntry[] => {
    const base = listWikiDirChildrenWithShares(files, dirPathProp, sharedMode ? null : receivedShares)
    if (!sharedMode) return base
    const sh = shareHandle?.trim()
    return sh ? withUnifiedPeerPrefixOnListEntries(base, sh) : base
  })

  const canShareCurrentDir = $derived(
    Boolean(!sharedMode && dirPath.trim() && !isSharedNamespacePath(dirPath)),
  )

  const shareAudienceVaultPath = $derived(vaultRelativeDirFromWikiBrowseDir(dirPathProp) ?? '')

  const dirShareAudienceCount = $derived(
    countOutgoingSharesForVaultPath(shareAudienceVaultPath, ownedShares),
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
      shareAudienceCount:
        canShareCurrentDir && dirShareAudienceCount > 0 ? dirShareAudienceCount : undefined,
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
    if (entry.kind === 'dir') return 'Folder'
    return 'Page'
  }

  function entryHasOutgoingShare(entry: WikiDirListEntry): boolean {
    if (sharedMode) return false
    if (entry.kind !== 'dir' && entry.kind !== 'file') return false
    return countOutgoingSharesForVaultPath(entry.path, ownedShares) > 0
  }

  function entryOutgoingAudienceCount(entry: WikiDirListEntry): number {
    if (sharedMode) return 0
    if (entry.kind !== 'dir' && entry.kind !== 'file') return 0
    return countOutgoingSharesForVaultPath(entry.path, ownedShares)
  }

  function formatShareAudienceBadge(n: number): string {
    return n > 9 ? '9+' : `${n}`
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
    onSharesChanged={() => void loadFiles()}
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
                  <Folder size={18} />
                {:else}
                  <FileText size={18} />
                {/if}
              </span>
              <span class="wiki-dir-label">{entry.label}</span>
              <span class="wiki-dir-meta">
                {metaForEntry(entry)}
                {#if entryOutgoingAudienceCount(entry) > 0}
                  <span
                    class="wiki-dir-share-count"
                    title={`Shared with ${entryOutgoingAudienceCount(entry)} people`}
                    aria-label={`Shared with ${entryOutgoingAudienceCount(entry)} people`}
                  >
                    {formatShareAudienceBadge(entryOutgoingAudienceCount(entry))}
                  </span>
                {/if}
              </span>
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

  .wiki-dir-label {
    font-weight: 600;
    min-width: 0;
    word-break: break-word;
  }

  .wiki-dir-meta {
    font-size: 0.8125rem;
    color: var(--text-3);
    white-space: nowrap;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .wiki-dir-share-count {
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6875rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent, #4a90d9) 22%, transparent);
    color: color-mix(in srgb, var(--accent, #4a90d9) 88%, var(--text));
    box-sizing: border-box;
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
