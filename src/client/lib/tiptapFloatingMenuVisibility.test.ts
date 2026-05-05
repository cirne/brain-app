import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'
import { floatingBlockMenuShouldShow } from './tiptapFloatingMenuVisibility.js'

function mountEditor(html: string): { editor: Editor; cleanup: () => void } {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const editor = new Editor({
    element: el,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })],
    content: html,
  })
  return {
    editor,
    cleanup: () => {
      editor.destroy()
      el.remove()
    },
  }
}

describe('floatingBlockMenuShouldShow', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
  })

  it('is true for an empty top-level paragraph', () => {
    const { editor, cleanup } = mountEditor('<p></p>')
    cleanups.push(cleanup)
    editor.chain().focus('start').run()
    ;(editor.view.dom as HTMLElement).focus()
    expect(floatingBlockMenuShouldShow(editor, editor.view)).toBe(true)
  })

  it('is false when the paragraph has text', () => {
    const { editor, cleanup } = mountEditor('<p>hello</p>')
    cleanups.push(cleanup)
    editor.chain().focus('start').run()
    expect(floatingBlockMenuShouldShow(editor, editor.view)).toBe(false)
  })

  it('is false when selection is in a heading', () => {
    const { editor, cleanup } = mountEditor('<h1>Title</h1><p></p>')
    cleanups.push(cleanup)
    editor.chain().focus('start').run()
    expect(floatingBlockMenuShouldShow(editor, editor.view)).toBe(false)
  })

  it('is false inside a blockquote paragraph', () => {
    const { editor, cleanup } = mountEditor('<blockquote><p></p></blockquote>')
    cleanups.push(cleanup)
    editor.chain().focus('start').run()
    expect(floatingBlockMenuShouldShow(editor, editor.view)).toBe(false)
  })

  it('is false inside a code block', () => {
    const { editor, cleanup } = mountEditor('<pre><code>x</code></pre>')
    cleanups.push(cleanup)
    editor.chain().focus('start').run()
    expect(floatingBlockMenuShouldShow(editor, editor.view)).toBe(false)
  })

  it('is false when the editor view does not have focus', () => {
    const { editor, cleanup } = mountEditor('<p></p>')
    cleanups.push(cleanup)
    const other = document.createElement('button')
    document.body.appendChild(other)
    other.focus()
    expect(floatingBlockMenuShouldShow(editor, editor.view)).toBe(false)
    other.remove()
  })
})
