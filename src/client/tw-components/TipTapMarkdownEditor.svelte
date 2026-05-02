<script lang="ts">
  /**
   * TipTap markdown editor (marked → HTML in, turndown → markdown out).
   * YAML front matter is preserved in the serialized markdown string.
   */
  import { onMount } from 'svelte'
  import { Editor } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import TurndownService from 'turndown'
  import { cn } from '@client/lib/cn.js'
  import { splitYamlFrontMatter, joinYamlFrontMatter, renderMarkdownBody } from '@client/lib/markdown.js'
  import '../styles/wiki/wikiMarkdown.css'

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })

  /** Round-trip `data-wiki` links back to Obsidian `[[path]]` / `[[path|label]]` (same as chat / wiki viewer). */
  turndown.addRule('wikiDataLink', {
    filter(node: HTMLElement): boolean {
      return node.nodeName === 'A' && Boolean(node.getAttribute('data-wiki'))
    },
    replacement(content: string, node: HTMLElement): string {
      const dw = node.getAttribute('data-wiki') ?? ''
      const pathForLink = dw.replace(/\.md$/i, '')
      const inner = content.trim()
      const baseName = pathForLink.includes('/')
        ? pathForLink.split('/').pop() || pathForLink
        : pathForLink
      if (inner === baseName || inner === pathForLink || inner === dw) {
        return `[[${pathForLink}]]`
      }
      return `[[${pathForLink}|${inner}]]`
    },
  })

  interface Props {
    initialMarkdown?: string
    disabled?: boolean
    /**
     * When true (default), debounced save on edit. When false, only {@link flushSave} invokes `onPersist`.
     */
    autoPersist?: boolean
    /** Called after debounce when `autoPersist`, or when `flushSave` runs (if set). */
    onPersist?: (_markdown: string) => Promise<void>
  }
  let { initialMarkdown = '', disabled = false, autoPersist = true, onPersist }: Props = $props()

  let mountEl = $state<HTMLDivElement | undefined>()
  let editor = $state<Editor | null>(null)
  let frontMatterCache = $state<string | null>(null)
  let lastImported = $state('')

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let syncingFromProp = false

  function mdBodyToHtml(body: string): string {
    const html = renderMarkdownBody(body || '')
    return html.trim() ? html : '<p></p>'
  }

  function htmlToMarkdownBody(html: string): string {
    return turndown.turndown(html).trim()
  }

  function fullMarkdownFromEditor(html: string): string {
    const body = htmlToMarkdownBody(html)
    return joinYamlFrontMatter(frontMatterCache, body)
  }

  function applyMarkdownToEditor(md: string) {
    if (!editor) return
    const { frontMatter: fm, body } = splitYamlFrontMatter(md)
    frontMatterCache = fm
    syncingFromProp = true
    editor.commands.setContent(mdBodyToHtml(body), { emitUpdate: false })
    syncingFromProp = false
  }

  function scheduleSave() {
    if (!autoPersist || !editor || disabled || syncingFromProp) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, 900)
  }

  async function persist(force = false) {
    if (!editor || (!force && disabled) || !onPersist) return
    const markdown = fullMarkdownFromEditor(editor.getHTML())
    try {
      await onPersist(markdown)
    } catch {
      /* ignore */
    }
  }

  /** Call before leaving edit mode or unmount to avoid losing debounced edits. */
  export async function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await persist(true)
  }

  /** Cancel debounced autosave timer without persisting. */
  export function cancelDebouncedSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  /** Current markdown including any preserved YAML front matter segment. */
  export function serializeMarkdown(): string {
    if (!editor) return ''
    return fullMarkdownFromEditor(editor.getHTML())
  }

  onMount(() => {
    if (!mountEl) return

    const ed = new Editor({
      element: null,
      injectCSS: false,
      editable: !disabled,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: {
            openOnClick: false,
            autolink: true,
            HTMLAttributes: { rel: 'noopener noreferrer' },
          },
        }),
      ],
      content: '<p></p>',
      editorProps: {
        attributes: {
          class: 'wiki-md',
          spellcheck: 'true',
        },
      },
      onUpdate: () => {
        if (!syncingFromProp) scheduleSave()
      },
    })

    ed.mount(mountEl)
    editor = ed

    const start = initialMarkdown
    lastImported = start
    applyMarkdownToEditor(start)

    return () => {
      if (saveTimer) clearTimeout(saveTimer)
      ed.destroy()
      editor = null
    }
  })

  $effect(() => {
    if (!editor) return
    if (initialMarkdown === lastImported) return
    lastImported = initialMarkdown
    applyMarkdownToEditor(initialMarkdown)
  })

  $effect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  })
</script>

<div
  class={cn(
    'tiptap-md-root flex min-h-0 flex-1 flex-col overflow-hidden',
    disabled && 'tiptap-md-root-disabled pointer-events-none opacity-65',
  )}
>
  <div class="tiptap-md-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden [-webkit-overflow-scrolling:touch]">
    <div
      class="tiptap-md-inner box-border w-full max-w-chat px-[clamp(1rem,4%,2.5rem)] pb-5 pt-4 mx-auto"
    >
      <div class="tiptap-md-mount min-h-[12rem]" bind:this={mountEl}></div>
    </div>
  </div>
</div>

<style>
  /* TipTap injects an editor div with class `wiki-md`; ensure usable min-height. */
  .tiptap-md-root :global(.wiki-md) {
    min-height: 11rem;
  }
</style>
