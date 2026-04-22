<script lang="ts">
  import { User } from 'lucide-svelte'
  import { getDirIcon, SpecialFileIcon } from './dirIcons.js'

  let { path, unsaved = false }: { path: string; unsaved?: boolean } = $props()

  const { folder, name } = $derived.by(() => {
    const clean = path.replace(/\.md$/, '')
    const slash = clean.lastIndexOf('/')
    if (slash < 0) return { folder: '', name: clean }
    return { folder: clean.slice(0, slash + 1), name: clean.slice(slash + 1) }
  })

  const folderKey = $derived(folder.replace(/\/$/, ''))

  const isIndex = $derived(name === '_index' || name.toLowerCase() === 'index')
  /** Root user profile — same convention as main agent (me.md at wiki root). */
  const isUserProfileMe = $derived(path === 'me.md')
  // _ prefix marks system/special pages (but not _index files with a folder)
  const isSpecial = $derived(name.startsWith('_') && !(isIndex && folder))

  // Display: strip leading _, convert hyphen-case to Title Case
  const displayName = $derived.by(() => {
    if (isIndex && folder) {
      // _index.md or index.md in a folder → show folder name (last segment)
      const seg = folderKey.split('/').pop() || folderKey
      return seg.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
    if (isIndex) return 'Index'
    const base = isSpecial ? name.slice(1) : name
    return base.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  })

  let IconComponent = $state<import('svelte').ComponentType<any> | null>(null)

  $effect(() => {
    if (!folderKey) { IconComponent = null; return }
    IconComponent = getDirIcon(folderKey, (icon) => { IconComponent = icon })
  })
</script>

<span
  class="wfn-title-row inline-flex min-w-0 items-center gap-1.5 overflow-hidden [font:inherit]"
  class:opacity-90={unsaved}
>
  {#if isUserProfileMe}
    <span class="wfn-lead-icon text-accent opacity-85" title="Profile (me.md)">
      <User size={12} />
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
