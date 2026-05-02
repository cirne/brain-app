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
  import { cn } from '@client/lib/cn.js'
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
  import WikiShareDialog from '@tw-components/WikiShareDialog.svelte'
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

<div class="wiki-dir flex min-h-0 flex-1 flex-col overflow-hidden">
  <WikiShareDialog
    open={shareDialogOpen}
    pathPrefix={shareDialogPrefix}
    targetKind={shareDialogTargetKind}
    onDismiss={() => {
      shareDialogOpen = false
    }}
    onSharesChanged={() => void loadFiles()}
  />
  <div
    class="wiki-dir-inner mx-auto box-border w-full max-w-chat min-h-0 flex-1 overflow-y-auto px-[clamp(1rem,4%,2.5rem)] py-6"
  >
    {#if loading}
      <p class="status m-0 text-sm text-muted">Loading…</p>
    {:else if loadError}
      <p class="status status-err m-0 text-sm text-[var(--text-3,var(--text-2))]">Could not load wiki file list.</p>
    {:else if entries.length === 0}
      <p class="status m-0 text-sm text-muted">No pages in this folder.</p>
    {:else}
      <ul
        class="wiki-dir-list m-0 flex list-none flex-col gap-0 p-0"
        aria-label={dirPath ? `Pages in ${dirPath}` : 'Wiki pages'}
      >
        {#each entries as entry (`${entry.kind}:${'path' in entry ? entry.path : entry.kind}`)}
          <li>
            <button
              type="button"
              class={cn(
                'wiki-dir-row group grid w-full cursor-pointer grid-cols-[auto_1fr_auto_auto] items-center gap-x-3.5 gap-y-3 border-0 border-b border-[color-mix(in_srgb,var(--border)_45%,transparent)] bg-transparent px-0 py-3 text-left text-foreground text-[0.9375rem] transition-[padding-left,color] duration-150 hover:pl-1 hover:text-accent',
                entryIsShared(entry) && 'wiki-dir-row--shared',
                entryHasOutgoingShare(entry) && 'wiki-dir-row--outgoing',
              )}
              onclick={() => onEntryClick(entry)}
            >
              <span
                class={cn(
                  'wiki-dir-icon flex shrink-0 text-muted',
                  entryIsShared(entry) &&
                    'wiki-dir-icon--shared text-[color-mix(in_srgb,var(--accent)_82%,var(--text-2))] group-hover:text-accent',
                )}
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
              <span class="wiki-dir-label min-w-0 font-semibold [word-break:break-word]"
                >{entry.label}</span
              >
              <span
                class="wiki-dir-meta inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-[0.8125rem] text-[var(--text-3,var(--text-2))]"
              >
                {metaForEntry(entry)}
                {#if entryOutgoingAudienceCount(entry) > 0}
                  <span
                    class="wiki-dir-share-count box-border inline-flex h-5 min-w-5 items-center justify-center bg-[color-mix(in_srgb,var(--accent,#4a90d9)_22%,transparent)] px-[5px] text-[0.6875rem] font-semibold leading-none text-[color-mix(in_srgb,var(--accent,#4a90d9)_88%,var(--text))] [font-variant-numeric:tabular-nums]"
                    title={`Shared with ${entryOutgoingAudienceCount(entry)} people`}
                    aria-label={`Shared with ${entryOutgoingAudienceCount(entry)} people`}
                  >
                    {formatShareAudienceBadge(entryOutgoingAudienceCount(entry))}
                  </span>
                {/if}
              </span>
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
