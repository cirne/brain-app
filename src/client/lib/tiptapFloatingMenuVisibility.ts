import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Visibility for TipTap {@link FloatingMenu}: show the block (“+”) menu only when the view has
 * focus, selection is collapsed, and the caret sits in a truly empty paragraph—not inside code
 * blocks or blockquotes. Mirrors TipTap’s default guards (`hasFocus`, `empty`, `isEditable`) while
 * narrowing which empty blocks qualify (plain `paragraph` only).
 */
export function floatingBlockMenuShouldShow(editor: Editor, view: EditorView): boolean {
  const state = editor.state
  const { selection } = state
  if (!view.hasFocus() || !selection.empty || !editor.isEditable) return false

  const { $anchor } = selection
  const node = $anchor.parent
  if (node.type.name !== 'paragraph' || node.content.size > 0) return false
  if (editor.isActive('codeBlock') || editor.isActive('blockquote')) return false
  return true
}
