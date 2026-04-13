<script lang="ts">
  import { getDirIcon, SpecialFileIcon } from './dirIcons.js'

  let { path }: { path: string } = $props()

  const { folder, name } = $derived.by(() => {
    const clean = path.replace(/\.md$/, '')
    const slash = clean.lastIndexOf('/')
    if (slash < 0) return { folder: '', name: clean }
    return { folder: clean.slice(0, slash + 1), name: clean.slice(slash + 1) }
  })

  const folderKey = $derived(folder.replace(/\/$/, ''))

  // _ prefix marks system/special pages
  const isSpecial = $derived(name.startsWith('_'))

  // Display: strip leading _, convert hyphen-case to Title Case
  const displayName = $derived.by(() => {
    const base = isSpecial ? name.slice(1) : name
    return base.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  })

  let IconComponent = $state<import('svelte').ComponentType<any> | null>(null)

  $effect(() => {
    if (!folderKey) { IconComponent = null; return }
    IconComponent = getDirIcon(folderKey, (icon) => { IconComponent = icon })
  })
</script>

<span class="wfn">
  {#if isSpecial}
    <span class="wfn-icon wfn-icon--special">
      <SpecialFileIcon size={12} />
    </span>
  {:else if folder}
    {#if IconComponent}
      <span class="wfn-icon" title={folder}>
        <IconComponent size={12} />
      </span>
    {:else}
      <span class="wfn-folder">{folder}</span>
    {/if}
  {/if}<span class="wfn-name">{displayName}</span>
</span>

<style>
  .wfn {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .wfn-icon {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    width: 14px;
    color: var(--text-2);
    opacity: 0.55;
    cursor: default;
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

  .wfn-icon--special {
    opacity: 0.35;
  }
</style>
