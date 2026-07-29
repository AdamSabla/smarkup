import { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/react'
import { getActiveEditor } from '@/lib/active-editor'
import { getActiveRawEditor } from '@/lib/active-raw-editor'

/**
 * Put the caret on the n-th top-level heading and scroll it into view.
 *
 * Counts only direct children of the doc, matching the outline parser, which
 * only treats a `#` at the start of a line as a heading. A heading nested in a
 * blockquote or list item is a heading node to ProseMirror but not to the
 * outline, and counting it here would drift the two out of step.
 */
const jumpVisual = (editor: Editor, headingIndex: number): boolean => {
  let seen = 0
  let pos = -1
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return
    if (seen === headingIndex) pos = offset
    seen++
  })
  if (pos < 0) return false
  editor
    .chain()
    .focus()
    .setTextSelection(pos + 1)
    .scrollIntoView()
    .run()
  return true
}

/**
 * Select the heading line at `offset` (a source-string offset) and centre it.
 * Selecting rather than just scrolling means the landing spot is obvious even
 * before the editor takes focus.
 */
const jumpRaw = (view: EditorView, offset: number): boolean => {
  const doc = view.state.doc
  if (offset < 0 || offset > doc.length) return false
  const line = doc.lineAt(offset)
  view.focus()
  view.dispatch({
    selection: { anchor: line.from, head: line.to },
    effects: EditorView.scrollIntoView(line.from, { y: 'center' })
  })
  return true
}

/**
 * Reveal a heading in whichever editor is mounted for the active tab.
 *
 * `headingIndex` addresses the visual editor (ProseMirror positions aren't
 * source offsets) and `sourceOffset` addresses the raw one; both describe the
 * same heading, so the caller computes them together and this picks whichever
 * the current mode can use.
 */
export const revealHeading = (headingIndex: number, sourceOffset: number): void => {
  // Two frames: one for React to commit the (possibly rewritten) content, one
  // for the editor to lay it out, so the scroll lands at the right place.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const visual = getActiveEditor()
      if (visual && !visual.isDestroyed && jumpVisual(visual, headingIndex)) return
      const raw = getActiveRawEditor()
      if (raw) jumpRaw(raw, sourceOffset)
    })
  })
}
