import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  brainFloatingMenuPluginKey,
  registerTipTapFloatingMenuEscapeTracking,
  tipTapFloatingBlockMenuVisibleInDom,
  tryDismissTipTapFloatingMenuFromEscape,
} from './tiptapFloatingMenuEscape.js'

function mountEditor(html: string): { editor: Editor; mountEl: HTMLElement; cleanup: () => void } {
  const mountEl = document.createElement('div')
  mountEl.setAttribute('data-tiptap-md-mount', '')
  document.body.appendChild(mountEl)
  const editor = new Editor({
    element: mountEl,
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } })],
    content: html,
  })
  return {
    editor,
    mountEl,
    cleanup: () => {
      editor.destroy()
      mountEl.remove()
    },
  }
}

describe('tipTapFloatingMenuEscape', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    while (cleanups.length) {
      cleanups.pop()?.()
    }
    document.querySelectorAll('.tiptap-floating-menu.test-float-menu').forEach((n) => n.remove())
  })

  it('tipTapFloatingBlockMenuVisibleInDom is false when no floating menu exists', () => {
    expect(tipTapFloatingBlockMenuVisibleInDom()).toBe(false)
  })

  it('tipTapFloatingBlockMenuVisibleInDom respects visibility style', () => {
    const menu = document.createElement('div')
    menu.className = 'tiptap-floating-menu test-float-menu'
    menu.style.visibility = 'visible'
    document.body.appendChild(menu)
    expect(tipTapFloatingBlockMenuVisibleInDom()).toBe(true)
  })

  it('tryDismissTipTapFloatingMenuFromEscape dispatches hide meta when menu is visible and editor is resolved', () => {
    const { editor, mountEl, cleanup } = mountEditor('<p></p>')
    cleanups.push(cleanup)
    const unreg = registerTipTapFloatingMenuEscapeTracking(editor, mountEl)
    cleanups.push(unreg)

    const menu = document.createElement('div')
    menu.className = 'tiptap-floating-menu test-float-menu'
    menu.style.visibility = 'visible'
    document.body.appendChild(menu)

    ;(editor.view.dom as HTMLElement).focus()
    const dispatchSpy = vi.spyOn(editor.view, 'dispatch')

    expect(tryDismissTipTapFloatingMenuFromEscape()).toBe(true)
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    const tr = dispatchSpy.mock.calls[0]![0]
    expect(tr.getMeta(brainFloatingMenuPluginKey)).toBe('hide')
  })

  it('tryDismissTipTapFloatingMenuFromEscape resolves editor when focus is inside the floating menu', () => {
    const { editor, mountEl, cleanup } = mountEditor('<p></p>')
    cleanups.push(cleanup)
    const unreg = registerTipTapFloatingMenuEscapeTracking(editor, mountEl)
    cleanups.push(unreg)

    const menu = document.createElement('div')
    menu.className = 'tiptap-floating-menu test-float-menu'
    menu.style.visibility = 'visible'
    const btn = document.createElement('button')
    btn.type = 'button'
    menu.appendChild(btn)
    document.body.appendChild(menu)

    ;(editor.view.dom as HTMLElement).focus()
    btn.focus()

    const dispatchSpy = vi.spyOn(editor.view, 'dispatch')
    expect(tryDismissTipTapFloatingMenuFromEscape()).toBe(true)
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    const tr = dispatchSpy.mock.calls[0]![0]
    expect(tr.getMeta(brainFloatingMenuPluginKey)).toBe('hide')
  })

  it('tryDismissTipTapFloatingMenuFromEscape returns false when the menu is not visible', () => {
    const { editor, mountEl, cleanup } = mountEditor('<p></p>')
    cleanups.push(cleanup)
    const unreg = registerTipTapFloatingMenuEscapeTracking(editor, mountEl)
    cleanups.push(unreg)
    ;(editor.view.dom as HTMLElement).focus()
    expect(tryDismissTipTapFloatingMenuFromEscape()).toBe(false)
  })
})
