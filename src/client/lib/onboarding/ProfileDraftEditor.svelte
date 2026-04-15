<script lang="ts">
  /**
   * TipTap editor for onboarding profile draft (markdown on disk, YAML front matter preserved).
   */
  import { onMount } from 'svelte'
  import { Editor } from '@tiptap/core'
  import StarterKit from '@tiptap/starter-kit'
  import { marked } from 'marked'
  import TurndownService from 'turndown'
  import { splitYamlFrontMatter, joinYamlFrontMatter } from '../markdown.js'

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })

  interface Props {
    initialMarkdown?: string
    disabled?: boolean
  }
  let { initialMarkdown = '', disabled = false }: Props = $props()

  let mountEl = $state<HTMLDivElement | undefined>()
  let editor = $state<Editor | null>(null)
  let frontMatterCache = $state<string | null>(null)
  let lastImported = $state('')

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let syncingFromProp = false

  function mdBodyToHtml(body: string): string {
    const raw = marked(body || '', { async: false }) as string
    const html = typeof raw === 'string' ? raw : ''
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
    if (!editor || disabled || syncingFromProp) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persist()
    }, 900)
  }

  async function persist() {
    if (!editor || disabled) return
    const markdown = fullMarkdownFromEditor(editor.getHTML())
    try {
      const res = await fetch('/api/onboarding/profile-draft', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      })
      if (!res.ok) return
    } catch {
      /* ignore */
    }
  }

  /** Call before Accept to avoid losing debounced edits. */
  export async function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await persist()
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
          class: 'profile-prose',
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

<div class="profile-draft-editor" class:profile-draft-editor-disabled={disabled}>
  <div class="profile-draft-scroll">
    <div class="profile-draft-inner">
      <div class="profile-draft-mount" bind:this={mountEl}></div>
    </div>
  </div>
</div>

<style>
  .profile-draft-editor {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .profile-draft-editor-disabled {
    opacity: 0.65;
    pointer-events: none;
  }

  .profile-draft-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }

  /** Readable column — matches chat / wiki (`--chat-column-max` in style.css) */
  .profile-draft-inner {
    max-width: var(--chat-column-max);
    width: 100%;
    margin-inline: auto;
    box-sizing: border-box;
    padding: 1rem clamp(1rem, 4%, 2.5rem) 1.25rem;
  }

  .profile-draft-mount {
    min-height: 12rem;
  }

  /* TipTap / ProseMirror — match app tokens */
  .profile-draft-editor :global(.profile-prose) {
    outline: none;
    padding: 0;
    font-size: 0.9375rem;
    line-height: 1.6;
    color: var(--text);
    min-height: 11rem;
  }

  .profile-draft-editor :global(.profile-prose p) {
    margin: 0.4em 0;
  }

  .profile-draft-editor :global(.profile-prose p:first-child) {
    margin-top: 0;
  }

  .profile-draft-editor :global(.profile-prose p:last-child) {
    margin-bottom: 0;
  }

  .profile-draft-editor :global(.profile-prose h1) {
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0.85em 0 0.35em;
    line-height: 1.25;
    color: var(--text);
  }

  .profile-draft-editor :global(.profile-prose h2) {
    font-size: 1.0625rem;
    font-weight: 650;
    letter-spacing: -0.015em;
    margin: 1.1em 0 0.35em;
    line-height: 1.3;
    color: var(--text);
  }

  .profile-draft-editor :global(.profile-prose h3) {
    font-size: 0.98rem;
    font-weight: 600;
    margin: 0.95em 0 0.3em;
    color: var(--text);
  }

  .profile-draft-editor :global(.profile-prose ul),
  .profile-draft-editor :global(.profile-prose ol) {
    margin: 0.4em 0 0.4em 1.25rem;
    padding: 0;
  }

  .profile-draft-editor :global(.profile-prose li) {
    margin: 0.2em 0;
  }

  .profile-draft-editor :global(.profile-prose a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .profile-draft-editor :global(.profile-prose strong) {
    font-weight: 650;
    color: var(--text);
  }

  .profile-draft-editor :global(.profile-prose code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.88em;
    padding: 0.1em 0.35em;
    border-radius: 0.25rem;
    background: var(--bg-3);
  }

  .profile-draft-editor :global(.profile-prose pre) {
    margin: 0.6em 0;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: var(--bg-3);
    overflow-x: auto;
    font-size: 0.84rem;
  }

  .profile-draft-editor :global(.profile-prose pre code) {
    padding: 0;
    background: none;
  }

  .profile-draft-editor :global(.profile-prose blockquote) {
    margin: 0.5em 0;
    padding-left: 0.9rem;
    border-left: 3px solid var(--border);
    color: var(--text-2);
  }

  .profile-draft-editor :global(.profile-prose hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 1rem 0;
  }
</style>
