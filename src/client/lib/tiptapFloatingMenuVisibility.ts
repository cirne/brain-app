import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Visibility for TipTap {@link FloatingMenu}.
 *
 * Matches `@tiptap/extension-floating-menu` defaults: only **root-depth** empty text blocks
 * (`$anchor.depth === 1`). Without that, every empty `paragraph` — including inside lists — qualifies,
 * which makes the “+ Blocks” menu appear constantly on mobile.
 *
 * Additional guards: plain `paragraph` only, not code block / blockquote (same as before).
 */
export function floatingBlockMenuShouldShow(editor: Editor, view: EditorView): boolean {
  const { selection } = editor.state
  const { $anchor } = selection
  const node = $anchor.parent

  let failedAt: string | null = null
  if (!view.hasFocus()) failedAt = 'noFocus'
  else if (!selection.empty) failedAt = 'selectionNotEmpty'
  else if (!editor.isEditable) failedAt = 'notEditable'
  else if ($anchor.depth !== 1) failedAt = 'notRootDepth'
  else if (node.type.name !== 'paragraph') failedAt = `parent:${node.type.name}`
  else if (node.content.size > 0) failedAt = 'paragraphNotEmpty'
  else if (editor.isActive('codeBlock')) failedAt = 'codeBlock'
  else if (editor.isActive('blockquote')) failedAt = 'blockquote'

  const result = failedAt === null

  return result
}
