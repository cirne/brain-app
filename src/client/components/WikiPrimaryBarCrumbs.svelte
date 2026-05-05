<script lang="ts">
  import CollapsibleBreadcrumb from '@components/CollapsibleBreadcrumb.svelte'
  import type { WikiPrimaryCrumb } from '@client/lib/wikiPrimaryBarCrumbs.js'

  /** Navigate to wiki directory; omit path for vault root. */
  type OpenWikiDir = (_path?: string) => void

  let {
    crumbs,
    onOpenWikiDir,
  }: {
    crumbs: WikiPrimaryCrumb[]
    onOpenWikiDir: OpenWikiDir
  } = $props()

  const breadcrumbItems = $derived.by(() =>
    crumbs.map((crumb) => {
      if (crumb.kind === 'wiki-root-link') {
        return {
          label: 'Wiki',
          onClick: () => onOpenWikiDir(undefined),
          isCurrent: false,
        }
      }
      if (crumb.kind === 'folder-link') {
        return {
          label: crumb.label,
          onClick: () => onOpenWikiDir(crumb.path),
          isCurrent: false,
        }
      }
      return {
        label: crumb.label,
        onClick: undefined,
        isCurrent: true,
      }
    }),
  )
</script>

<div
  class="wiki-primary-crumbs flex min-w-0 flex-1 items-center text-[13px] font-medium text-muted"
  aria-label="Wiki location"
>
  <CollapsibleBreadcrumb items={breadcrumbItems} />
</div>
