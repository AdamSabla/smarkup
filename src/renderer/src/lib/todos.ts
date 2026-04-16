import { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/react'

/**
 * Matches `TODO` as a standalone token (so it doesn't fire on words that
 * happen to contain those letters). Case-sensitive on purpose — the token is
 * a deliberate yellow flag the user types, not natural-language "todo".
 */
export const TODO_RE = /\bTODO\b/g

/**
 * Matches `// some comment` from the slashes through end of line. Negative
 * lookbehind on `:` keeps URLs (`https://`, `http://`, …) out of the match.
 */
export const COMMENT_RE = /(?<!:)\/\/[^\n]*/g

export type TodoOccurrence = {
  raw: string
  /** Start offset in the source string */
  from: number
  /** End offset (exclusive) in the source string */
  to: number
}

/**
 * Find every `TODO` token in the markdown source, in document order.
 */
export const extractTodos = (content: string): TodoOccurrence[] => {
  const out: TodoOccurrence[] = []
  TODO_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TODO_RE.exec(content))) {
    out.push({ raw: match[0], from: match.index, to: match.index + match[0].length })
  }
  return out
}

/**
 * Select the given range in the CodeMirror view, scroll it into the center
 * of the viewport, and flash a yellow highlight over it. Mirrors
 * jumpToRawRange in lib/variables.ts but uses the TODO flash color.
 */
export const jumpToRawTodo = (view: EditorView, from: number, to: number): void => {
  const docLen = view.state.doc.length
  if (from < 0 || to > docLen) return
  view.focus()
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: 'center' })
  })
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flashRectsForRawRange(view, from, to)
    })
  })
}

const flashRectsForRawRange = (view: EditorView, from: number, to: number): void => {
  const rects: DOMRect[] = []
  const fromCoords = view.coordsAtPos(from)
  const toCoords = view.coordsAtPos(to)
  if (!fromCoords || !toCoords) return
  if (Math.abs(fromCoords.top - toCoords.top) < 1) {
    rects.push(
      new DOMRect(
        fromCoords.left,
        fromCoords.top,
        toCoords.right - fromCoords.left,
        fromCoords.bottom - fromCoords.top
      )
    )
  } else {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      for (const r of sel.getRangeAt(0).getClientRects()) rects.push(r as DOMRect)
    }
  }
  renderFlash(rects)
}

/**
 * Find the N-th literal `TODO` inside the Tiptap doc and select it. Same
 * approach as jumpToVisualOccurrence in lib/variables.ts — the visual editor
 * uses ProseMirror positions, not source-string offsets, so we walk the doc
 * to map the literal text to pm positions.
 */
export const jumpToVisualTodo = (editor: Editor, occurrenceIndex: number): boolean => {
  const target = 'TODO'
  const hits: Array<{ from: number; to: number }> = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const text = node.text
    let searchFrom = 0
    while (searchFrom <= text.length - target.length) {
      const idx = text.indexOf(target, searchFrom)
      if (idx === -1) break
      // Word-boundary check so we match `\bTODO\b` like the regex does.
      const before = idx === 0 ? '' : text[idx - 1]
      const after = idx + target.length >= text.length ? '' : text[idx + target.length]
      const isWordChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c)
      if (!isWordChar(before) && !isWordChar(after)) {
        hits.push({ from: pos + idx, to: pos + idx + target.length })
      }
      searchFrom = idx + target.length
    }
    return false
  })
  const hit = hits[occurrenceIndex]
  if (!hit) return false
  editor.chain().focus().setTextSelection({ from: hit.from, to: hit.to }).scrollIntoView().run()
  requestAnimationFrame(() => {
    const rects: DOMRect[] = []
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      for (const r of sel.getRangeAt(0).getClientRects()) rects.push(r as DOMRect)
    }
    renderFlash(rects)
  })
  return true
}

/**
 * Yellow flash overlay drawn at the given viewport rects, fading out over
 * ~600ms. Same pattern as renderFlash in lib/variables.ts but with the TODO
 * color so the jump destination is unmistakable even without editor focus.
 */
const renderFlash = (rects: DOMRect[] | Iterable<DOMRect>): void => {
  const rectList = Array.from(rects).filter((r) => r.width > 0 && r.height > 0)
  if (rectList.length === 0) return
  const overlays: HTMLElement[] = []
  for (const rect of rectList) {
    const el = document.createElement('div')
    el.className = 'smarkup-todo-flash'
    el.style.left = `${rect.left}px`
    el.style.top = `${rect.top}px`
    el.style.width = `${rect.width}px`
    el.style.height = `${rect.height}px`
    document.body.appendChild(el)
    overlays.push(el)
  }
  requestAnimationFrame(() => {
    for (const el of overlays) el.classList.add('smarkup-todo-flash-fade')
  })
  setTimeout(() => {
    for (const el of overlays) el.remove()
  }, 700)
}
