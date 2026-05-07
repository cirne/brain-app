<script lang="ts">
  import { BookOpen, User } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { getDirIcon, SpecialFileIcon } from '@client/lib/dirIcons.js'
  import { isWikiRootIndexPath } from '@client/lib/wikiPathDisplay.js'
  import { wikiVaultPathDisplayName } from '@client/lib/wikiFileNameLabels.js'

  let { path, unsaved = false }: { path: string; unsaved?: boolean } = $props()

  const { folder, name } = $derived.by(() => {
    const clean = path.replace(/\.md$/, '')
    const slash = clean.lastIndexOf('/')
    if (slash < 0) return { folder: '', name: clean }
    return { folder: clean.slice(0, slash + 1), name: clean.slice(slash + 1) }
  })

  const folderKey = $derived(folder.replace(/\/$/, ''))

  const isIndex = $derived(name === '_index' || name.toLowerCase() === 'index')
  const isUserProfileMe = $derived(path === 'me.md')
  const isSpecial = $derived(name.startsWith('_') && !(isIndex && folder))

  const displayName = $derived(wikiVaultPathDisplayName(path))

  let IconComponent = $state<import('svelte').ComponentType<any> | null>(null)

  $effect(() => {
    if (!folderKey) { IconComponent = null; return }
    IconComponent = getDirIcon(folderKey, (icon) => { IconComponent = icon })
  })
</script>

<span
  class={cn(
    'wfn-title-row inline-flex min-w-0 items-center gap-1.5 overflow-hidden [font:inherit]',
    unsaved && 'opacity-90',
  )}
>
  {#if isUserProfileMe}
    <span class="wfn-lead-icon text-accent opacity-85" title="Profile (me.md)">
      <User size={12} />
    </span>
  {:else if isWikiRootIndexPath(path)}
    <span class="wfn-lead-icon text-accent opacity-85" title="My Wiki">
      <BookOpen size={12} />
    </span>
  {:else if isSpecial}
    <span class="wfn-lead-icon wfn-lead-icon--special">
      <SpecialFileIcon size={12} />
    </span>
  {:else if folder}
    {#if IconComponent}
      <span class="wfn-lead-icon" title={folder}>
        <IconComponent size={12} />
      </span>
    {:else}
      <span
        class="wfn-folder min-w-0 shrink overflow-hidden text-[0.9em] text-ellipsis text-muted/65 [white-space:nowrap]"
      >{folder}</span>
    {/if}
  {/if}<span class="wfn-name shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">{displayName}</span>
</span>
