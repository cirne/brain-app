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

  const isIndex = $derived(name === '_index')
  /** Root user profile — same convention as main agent (me.md at wiki root). */
  const isUserProfileMe = $derived(path === 'me.md')
  // _ prefix marks system/special pages (but not _index files with a folder)
  const isSpecial = $derived(name.startsWith('_') && !(isIndex && folder))

  // Display: strip leading _, convert hyphen-case to Title Case
  const displayName = $derived.by(() => {
    if (isIndex && folder) {
      // _index.md in a folder → show folder name (last segment)
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

<span class="wfn-title-row" class:wfn-title-row--unsaved={unsaved}>
  {#if isUserProfileMe}
    <span class="wfn-lead-icon wfn-lead-icon--profile" title="Profile (me.md)">
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
      <span class="wfn-folder">{folder}</span>
    {/if}
  {/if}<span class="wfn-name">{displayName}</span>
</span>

<style>
  @import './wfnLeadIcon.css';

  .wfn-lead-icon--profile {
    color: var(--accent);
    opacity: 0.85;
  }

  .wfn-folder {
    font-size: 0.9em;
    color: var(--text-2);
    opacity: 0.65;
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .wfn-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
  }


</style>
