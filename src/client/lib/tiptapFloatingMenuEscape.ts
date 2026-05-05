import type { Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'

const MOUNT_SELECTOR = '[data-tiptap-md-mount]'

/**
 * Single shared {@link PluginKey} for TipTap `FloatingMenu` + Escape-dismiss meta. ProseMirror keys
 * transactions by internal id (`floatingMenu$`, …); the instance must be the same one passed to
 * {@link FloatingMenu.configure}.
 */
export const brainFloatingMenuPluginKey = new PluginKey('brainFloatingBlockMenu')

const mountToEditor = new WeakMap<HTMLElement, Editor>()

/** Editor that last received TipTap focus — used when Escape fires while focus is on the floating menu. */
let lastFocusedTipTapEditor: Editor | null = null

export function tipTapFloatingBlockMenuVisibleInDom(): boolean {
  for (const el of document.querySelectorAll('.tiptap-floating-menu')) {
    if (!(el instanceof HTMLElement)) continue
    if (el.style.visibility === 'visible') return true
    const cs = getComputedStyle(el)
    if (cs.visibility === 'visible' && cs.opacity !== '0') return true
  }
  return false
}

/**
 * Call once per TipTap instance so {@link tryDismissTipTapFloatingMenuFromEscape} can resolve the
 * editor and dispatch the plugin `hide` meta.
 */
export function registerTipTapFloatingMenuEscapeTracking(
  editor: Editor,
  mountEl: HTMLElement,
): () => void {
  mountToEditor.set(mountEl, editor)
  const onFocus = () => {
    lastFocusedTipTapEditor = editor
  }
  editor.on('focus', onFocus)
  return () => {
    editor.off('focus', onFocus)
    mountToEditor.delete(mountEl)
    if (lastFocusedTipTapEditor === editor) lastFocusedTipTapEditor = null
  }
}

function resolveEditorForFloatingMenuDismiss(): Editor | null {
  const ae = document.activeElement
  if (ae instanceof HTMLElement) {
    if (ae.closest('.tiptap-floating-menu')) {
      return lastFocusedTipTapEditor && !lastFocusedTipTapEditor.isDestroyed
        ? lastFocusedTipTapEditor
        : null
    }
    const mount = ae.closest(MOUNT_SELECTOR)
    if (mount instanceof HTMLElement) {
      const ed = mountToEditor.get(mount)
      if (ed && !ed.isDestroyed) return ed
    }
  }
  return lastFocusedTipTapEditor && !lastFocusedTipTapEditor.isDestroyed ? lastFocusedTipTapEditor : null
}

/**
 * If the TipTap block floating menu is visible, hide it via the FloatingMenu plugin and return
 * true so global Escape handling can skip closing the slide-over overlay.
 */
export function tryDismissTipTapFloatingMenuFromEscape(): boolean {
  if (!tipTapFloatingBlockMenuVisibleInDom()) return false
  const editor = resolveEditorForFloatingMenuDismiss()
  if (!editor) return false
  editor.view.dispatch(editor.state.tr.setMeta(brainFloatingMenuPluginKey, 'hide'))
  return true
}
