import type { Editor } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import { floatingBlockMenuShouldShow } from './tiptapFloatingMenuVisibility.js'

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

type MobileBlockMenuDismiss = () => boolean

const mobileBlockMenuDismissers: MobileBlockMenuDismiss[] = []

/** Registers a handler tried before TipTap FloatingMenu `hide` meta (narrow viewports use a manual long-press block menu). */
export function registerTipTapMobileBlockMenuEscape(dismiss: MobileBlockMenuDismiss): () => void {
  mobileBlockMenuDismissers.push(dismiss)
  return () => {
    const i = mobileBlockMenuDismissers.indexOf(dismiss)
    if (i >= 0) mobileBlockMenuDismissers.splice(i, 1)
  }
}

export function tipTapFloatingBlockMenuVisibleInDom(): boolean {
  for (const el of document.querySelectorAll('.tiptap-floating-menu')) {
    if (!(el instanceof HTMLElement)) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none') continue
    const op = parseFloat(cs.opacity)
    if (Number.isFinite(op) && op === 0) continue
    if (el.style.visibility === 'visible') return true
    if (cs.visibility === 'visible') return true
    const r = el.getBoundingClientRect()
    if (r.width > 4 && r.height > 4 && cs.visibility !== 'hidden') return true
  }
  return false
}

/**
 * TipTap's FloatingMenu can leave the block menu visible when `shouldShow` is already false (often on
 * mobile). Force-hide via the plugin meta so DOM matches {@link floatingBlockMenuShouldShow}.
 *
 * **Do not** gate on {@link tipTapFloatingBlockMenuVisibleInDom}: iOS/WebKit often reports visibility
 * differently than desktop, so we'd skip `hide` while the menu is still on screen.
 */
export function hideStaleBrainFloatingBlockMenu(editor: Editor): void {
  if (editor.isDestroyed) return
  if (floatingBlockMenuShouldShow(editor, editor.view)) return
  editor.view.dispatch(editor.state.tr.setMeta(brainFloatingMenuPluginKey, 'hide'))
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
  for (let i = mobileBlockMenuDismissers.length - 1; i >= 0; i--) {
    if (mobileBlockMenuDismissers[i]!()) return true
  }
  if (!tipTapFloatingBlockMenuVisibleInDom()) return false
  const editor = resolveEditorForFloatingMenuDismiss()
  if (!editor) return false
  editor.view.dispatch(editor.state.tr.setMeta(brainFloatingMenuPluginKey, 'hide'))
  return true
}
