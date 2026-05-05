<script lang="ts">
  /**
   * TipTap markdown editor (marked → HTML in, turndown → markdown out).
   * Notion-like UX: placeholder, floating block menu on empty lines, bubble formatting on selection.
   * YAML front matter is preserved in the serialized markdown string.
   */
  import { onMount, tick, untrack } from 'svelte'
  import { Editor } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import BubbleMenu from '@tiptap/extension-bubble-menu'
  import FloatingMenu from '@tiptap/extension-floating-menu'
  import { Placeholder } from '@tiptap/extension-placeholder'
  import TurndownService from 'turndown'
  import {
    Bold,
    Code2,
    Heading1,
    Heading2,
    Heading3,
    Italic,
    List,
    ListOrdered,
    Minus,
    Plus,
    Quote,
    Strikethrough,
  } from 'lucide-svelte'
  import { cn } from '@client/lib/cn.js'
  import { splitYamlFrontMatter, joinYamlFrontMatter, renderMarkdownBody } from '@client/lib/markdown.js'
  import { wikiLinkRefFromAnchor } from '@client/lib/wikiPageHtml.js'
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
    /** Own wiki: follow `data-wiki` / internal links on click (vault navigation). */
    onWikiLinkNavigate?: (_wikiRef: string) => void
  }

  type WikiNavigateCb = NonNullable<Props['onWikiLinkNavigate']>

  let {
    initialMarkdown = '',
    disabled = false,
    autoPersist = true,
    onPersist,
    onWikiLinkNavigate,
  }: Props = $props()

  /**
   * Link navigation runs from TipTap `onMount` handler — avoid `$effect` writing locals from props
   * (can interact badly with effect scheduling). `$effect.pre` + `$state.raw` updates without subscribing.
   */
  const wikiLinkNav = $state.raw<{ cb?: WikiNavigateCb }>({})
  $effect.pre(() => {
    wikiLinkNav.cb = onWikiLinkNavigate
  })

  let mountEl = $state<HTMLDivElement | undefined>()
  let bubbleMenuEl = $state<HTMLDivElement | undefined>()
  let floatingMenuEl = $state<HTMLDivElement | undefined>()
  let editor = $state<Editor | null>(null)
  /** Bumps on TipTap selection/doc updates so bubble toolbar `aria-pressed` stays in sync. */
  let chromeRev = $state(0)

  const bubbleFmt = $derived.by(() => {
    void chromeRev
    const ed = editor
    if (!ed) {
      return { bold: false, italic: false, strike: false, code: false }
    }
    return {
      bold: ed.isActive('bold'),
      italic: ed.isActive('italic'),
      strike: ed.isActive('strike'),
      code: ed.isActive('code'),
    }
  })
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

  function menuMouseDown(e: MouseEvent) {
    e.preventDefault()
  }

  onMount(() => {
    let cancelled = false
    let mounted: Editor | null = null

    void (async () => {
      await tick()
      if (cancelled || !mountEl || !bubbleMenuEl || !floatingMenuEl) return

      const appendMenusToBody = () =>
        typeof document !== 'undefined' ? document.body : mountEl!.parentElement!

      mounted = new Editor({
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
          Placeholder.configure({
            placeholder: ({ node }) => {
              if (node.type.name === 'heading') {
                return 'Heading'
              }
              return "Write, or use + for headings & lists"
            },
            showOnlyCurrent: true,
          }),
          BubbleMenu.configure({
            element: bubbleMenuEl,
            appendTo: appendMenusToBody,
            updateDelay: 80,
            options: {
              strategy: 'fixed',
              placement: 'top',
              offset: 8,
              flip: true,
              shift: true,
            },
            shouldShow: ({ editor: ed2, state }) => {
              const { from, to } = state.selection
              if (from === to || ed2.isActive('codeBlock')) return false
              return true
            },
          }),
          FloatingMenu.configure({
            element: floatingMenuEl,
            appendTo: appendMenusToBody,
            updateDelay: 80,
            options: {
              strategy: 'fixed',
              placement: 'left-start',
              offset: { mainAxis: 0, crossAxis: -4 },
              flip: true,
              shift: true,
            },
          }),
        ],
        content: '<p></p>',
        editorProps: {
          attributes: {
            class: 'wiki-md wiki-md--tiptap-notion',
            spellcheck: 'true',
          },
          handleDOMEvents: {
            click: (_view, event) => {
              const cb = wikiLinkNav.cb
              if (!cb) return false
              const t = event.target
              const start =
                t instanceof Element ? t : ((t as Node | null)?.parentElement ?? null)
              if (!start) return false
              const el = start.closest('a')
              if (!(el instanceof HTMLAnchorElement)) return false
              const ref = wikiLinkRefFromAnchor(el)
              if (!ref) return false
              event.preventDefault()
              cb(ref)
              return true
            },
          },
        },
        onSelectionUpdate: () => {
          chromeRev++
        },
        onUpdate: () => {
          chromeRev++
          if (!syncingFromProp) scheduleSave()
        },
      })

      mounted.mount(mountEl)
      editor = mounted

      const start = initialMarkdown
      lastImported = start
      applyMarkdownToEditor(start)
    })()

    return () => {
      cancelled = true
      if (saveTimer) clearTimeout(saveTimer)
      mounted?.destroy()
      mounted = null
      editor = null
    }
  })

  /** Only track `editor` + `initialMarkdown`; comparing/updating `lastImported` runs inside `untrack` so writes don't retrigger this effect. */
  $effect(() => {
    const ed = editor
    const md = initialMarkdown
    if (!ed) return
    untrack(() => {
      const li = lastImported
      if (md === li) return
      lastImported = md
      applyMarkdownToEditor(md)
    })
  })

  /** TipTap fires `onUpdate` on every `setEditable`; guard avoids `$effect` ↔ `onUpdate` ping-pong (infinite flush depth). */
  $effect(() => {
    const ed = editor
    if (!ed) return
    const want = !disabled
    if (ed.isEditable === want) return
    ed.setEditable(want)
  })
</script>

<div
  class={cn(
    'tiptap-md-root relative flex min-h-0 flex-1 flex-col overflow-hidden',
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

  <!-- Menus sit here until TipTap `show()` reparents to `body`; before first show, `hide()` is a
       no-op so they must not participate in the flex column (otherwise they steal scroll height). -->
  <div
    class="tiptap-menu-host pointer-events-none absolute left-0 top-0 z-[80] h-0 w-0 overflow-visible"
    aria-hidden="true"
  >
    <div
      bind:this={bubbleMenuEl}
      class="tiptap-surface-menu tiptap-bubble-menu flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-1 shadow-lg"
      role="toolbar"
      aria-label="Formatting"
      onmousedown={menuMouseDown}
    >
      {#if editor}
      <button
        type="button"
        class="tiptap-menu-btn rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-foreground aria-pressed:bg-surface-3"
        aria-label="Bold"
        aria-pressed={bubbleFmt.bold}
        onclick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold size={15} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        class="tiptap-menu-btn rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-foreground aria-pressed:bg-surface-3"
        aria-label="Italic"
        aria-pressed={bubbleFmt.italic}
        onclick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        class="tiptap-menu-btn rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-foreground aria-pressed:bg-surface-3"
        aria-label="Strikethrough"
        aria-pressed={bubbleFmt.strike}
        onclick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={15} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        class="tiptap-menu-btn rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-foreground aria-pressed:bg-surface-3"
        aria-label="Code"
        aria-pressed={bubbleFmt.code}
        onclick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Code2 size={15} strokeWidth={2.25} />
      </button>
      {/if}
    </div>

    <div
      bind:this={floatingMenuEl}
      class="tiptap-surface-menu tiptap-floating-menu flex flex-col gap-0.5 rounded-lg border border-border bg-surface-2 p-1 shadow-lg"
      role="menu"
      aria-label="Turn into"
      onmousedown={menuMouseDown}
    >
      {#if editor}
      <div
        class="flex items-center gap-1 border-b border-border px-1 pb-1 mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted"
      >
        <Plus size={12} strokeWidth={2.5} aria-hidden="true" />
        <span>Blocks</span>
      </div>
      <button
        type="button"
        class="tiptap-menu-btn flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-3"
        role="menuitem"
        onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 size={15} strokeWidth={2} class="shrink-0 text-muted" />
        Heading 1
      </button>
      <button
        type="button"
        class="tiptap-menu-btn flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-3"
        role="menuitem"
        onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={15} strokeWidth={2} class="shrink-0 text-muted" />
        Heading 2
      </button>
      <button
        type="button"
        class="tiptap-menu-btn flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-3"
        role="menuitem"
        onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={15} strokeWidth={2} class="shrink-0 text-muted" />
        Heading 3
      </button>
      <button
        type="button"
        class="tiptap-menu-btn flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-3"
        role="menuitem"
        onclick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List size={15} strokeWidth={2} class="shrink-0 text-muted" />
        Bullet list
      </button>
      <button
        type="button"
        class="tiptap-menu-btn flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-3"
        role="menuitem"
        onclick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} strokeWidth={2} class="shrink-0 text-muted" />
        Numbered list
      </button>
      <button
        type="button"
        class="tiptap-menu-btn flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-3"
        role="menuitem"
        onclick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={15} strokeWidth={2} class="shrink-0 text-muted" />
        Quote
      </button>
      <button
        type="button"
        class="tiptap-menu-btn flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-3"
        role="menuitem"
        onclick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 size={15} strokeWidth={2} class="shrink-0 text-muted" />
        Code block
      </button>
      <button
        type="button"
        class="tiptap-menu-btn flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-surface-3"
        role="menuitem"
        onclick={() => editor?.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={15} strokeWidth={2} class="shrink-0 text-muted" />
        Divider
      </button>
      {/if}
    </div>
  </div>
</div>

<style>
  /* TipTap injects an editor div with class `wiki-md`; ensure usable min-height. */
  .tiptap-md-root :global(.wiki-md) {
    min-height: 11rem;
  }

  /* Notion-like: calmer block rhythm in edit mode */
  .tiptap-md-root :global(.wiki-md--tiptap-notion p) {
    margin: 0.35em 0;
  }

  .tiptap-md-root :global(.wiki-md--tiptap-notion h1) {
    margin-top: 1em;
  }

  /*
   * Menus are `appendTo: document.body`; ensure an opaque paint layer (Tailwind `bg-surface-2`).
   * Prior `bg-[var(--surface-2)]` used an undefined token → transparent stack bleed-through.
   */
  :global(.tiptap-surface-menu) {
    background-color: var(--bg-2);
  }

  /* Menus start hidden; Floating UI sets visibility when positioned */
  :global(.tiptap-surface-menu.tiptap-bubble-menu),
  :global(.tiptap-surface-menu.tiptap-floating-menu) {
    visibility: hidden;
    z-index: 80;
  }
</style>
