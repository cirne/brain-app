<script lang="ts">
  import WikiFileName from '../WikiFileName.svelte'
  import { renderMarkdown, stripFrontMatter, takeFirstLines, WIKI_PREVIEW_MAX_LINES } from '../markdown.js'

  let {
    path,
    excerpt,
    onOpen,
  }: {
    path: string
    excerpt: string
    onOpen: () => void
  } = $props()

  const previewHtml = $derived.by(() => {
    const body = stripFrontMatter(excerpt)
    const limited = takeFirstLines(body, WIKI_PREVIEW_MAX_LINES)
    return renderMarkdown(limited)
  })
</script>

<div class="relative my-2 rounded-lg border border-border bg-surface-3 px-3 py-2.5">
  <button
    type="button"
    class="absolute inset-0 z-0 m-0 cursor-pointer rounded-[inherit] border-none bg-transparent p-0"
    aria-label="Open doc: {path}"
    onclick={onOpen}
  ></button>
  <div class="relative z-[1] mb-1.5 [pointer-events:none]">
    <WikiFileName {path} />
  </div>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <div
    class="wiki-preview-excerpt relative z-[1] m-0 max-h-[120px] overflow-hidden text-xs leading-snug text-foreground [word-break:break-word] [pointer-events:none] [&_.date-link]:relative [&_.date-link]:z-[2] [&_.date-link]:inline [&_.date-link]:cursor-pointer [&_.date-link]:border-none [&_.date-link]:bg-transparent [&_.date-link]:p-0 [&_.date-link]:font-inherit [&_.date-link]:text-accent [&_.date-link]:underline [&_.wiki-link]:relative [&_.wiki-link]:z-[2] [&_.wiki-link]:inline [&_.wiki-link]:cursor-pointer [&_.wiki-link]:border-none [&_.wiki-link]:bg-transparent [&_.wiki-link]:p-0 [&_.wiki-link]:font-inherit [&_.wiki-link]:text-accent [&_.wiki-link]:underline [&_a]:relative [&_a]:z-[2] [&_a]:text-accent [&_a]:[pointer-events:auto] [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.92em] [&_h1]:mb-[0.35em] [&_h1]:mt-0 [&_h1]:text-[1.15em] [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:my-2 [&_h2]:mt-2 [&_h2]:text-[1.05em] [&_h2]:font-semibold [&_h3]:my-[0.45em] [&_h3]:mt-[0.45em] [&_h3]:text-base [&_h3]:font-semibold [&_ol]:my-2 [&_ol]:ml-[1.1em] [&_ol]:text-muted [&_p]:mb-[0.45em] [&_p]:mt-0 [&_p]:text-muted [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:ml-[1.1em] [&_ul]:text-muted"
  >
    {@html previewHtml}
  </div>
</div>
