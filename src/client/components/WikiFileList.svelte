<script lang="ts">
  import WikiFileName from '@components/WikiFileName.svelte'

  let {
    dirty = [],
    recent = [],
    onOpen,
    showSectionLabels = true,
    showRecent = true,
    formatDate,
  }: {
    dirty?: string[]
    recent?: { path: string; date: string }[]
    onOpen: (_path: string) => void
    showSectionLabels?: boolean
    showRecent?: boolean
    formatDate?: (_date: string) => string
  } = $props()

  function defaultFormat(date: string) {
    const d = new Date(date + 'T12:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const fmt = $derived(formatDate ?? defaultFormat)
</script>

{#if dirty.length > 0}
  {#if showSectionLabels}
    <div
      class="wfl-section unsaved-label border-b border-border px-3 pb-[3px] pt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted"
    >Unsaved</div>
  {/if}
  {#each dirty as path (path)}
    <button
      class="wfl-item wfl-item--unsaved box-border grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-2 [&:hover_.wfn-folder]:text-accent [&:hover_.wfn-folder]:opacity-70 [&:hover_.wfn-name]:text-accent [&_.wfn-title-row]:overflow-hidden [&_.wfn-title-row]:text-xs [&_.wfn-title-row]:text-foreground"
      onmousedown={(e) => { e.preventDefault(); onOpen(path) }}
    >
      <span class="wfl-meta dot box-border justify-self-start whitespace-nowrap p-1 text-[8px] leading-none text-[#e8a020]">●</span>
      <WikiFileName {path} unsaved={true} />
    </button>
  {/each}
{/if}

{#if showRecent && recent.length > 0}
  {#if showSectionLabels && dirty.length > 0}
    <div
      class="wfl-section border-b border-border px-3 pb-[3px] pt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted"
    >Recent</div>
  {/if}
  {#each recent as file (file.path)}
    <button
      class="wfl-item box-border grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-surface-2 [&:hover_.wfn-folder]:text-accent [&:hover_.wfn-folder]:opacity-70 [&:hover_.wfn-name]:text-accent [&_.wfn-title-row]:overflow-hidden [&_.wfn-title-row]:text-xs [&_.wfn-title-row]:text-foreground"
      onmousedown={(e) => { e.preventDefault(); onOpen(file.path) }}
    >
      <span class="wfl-meta box-border justify-self-start whitespace-nowrap p-1 text-[11px] text-muted">{fmt(file.date)}</span>
      <WikiFileName path={file.path} />
    </button>
  {/each}
{/if}
