import { EditorView } from '@codemirror/view'
import type { Editor } from '@tiptap/react'

/** Matches `{{anything_but_closing_braces}}` — the same pattern RawEditor's
 *  placeholderHighlighter uses so the panel and the highlight agree. */
export const VARIABLE_RE = /\{\{[^}]+\}\}/g

export type VariableOccurrence = {
  /** Full matched text, e.g. `{{product_name}}` */
  raw: string
  /** Extracted variable name (trimmed of surrounding whitespace) */
  name: string
  /** Start offset in the source string */
  from: number
  /** End offset (exclusive) in the source string */
  to: number
}

export type VariableGroup = {
  /** Canonical variable name — the panel groups occurrences by this */
  name: string
  /** All occurrences of this variable, in document order */
  occurrences: VariableOccurrence[]
}

/**
 * Extract all `{{variable}}` occurrences from the given markdown content and
 * group them by name. Order within each group matches source order.
 */
export const extractVariables = (content: string): VariableGroup[] => {
  const groups = new Map<string, VariableGroup>()
  // Reset global regex state each call — it's a module-level literal.
  VARIABLE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = VARIABLE_RE.exec(content))) {
    const raw = match[0]
    const name = raw.slice(2, -2).trim()
    if (!name) continue
    const occ: VariableOccurrence = {
      raw,
      name,
      from: match.index,
      to: match.index + raw.length
    }
    const existing = groups.get(name)
    if (existing) existing.occurrences.push(occ)
    else groups.set(name, { name, occurrences: [occ] })
  }
  return Array.from(groups.values())
}

/**
 * Select the given source-offset range in the CodeMirror view, scroll it
 * into the center of the viewport, and flash a highlight over the matched
 * text. The range targets a `{{...}}` match found in the source string,
 * so the offsets map directly.
 */
export const jumpToRawRange = (view: EditorView, from: number, to: number): void => {
  const docLen = view.state.doc.length
  if (from < 0 || to > docLen) return
  view.focus()
  view.dispatch({
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: 'center' })
  })
  // Wait for the scroll + selection to commit before reading DOM rects.
  // coordsAtPos reflects the pending layout after dispatch returns, but
  // the scroll hasn't animated yet; a double rAF lands reliably.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flashRectsForRawRange(view, from, to)
    })
  })
}

const flashRectsForRawRange = (view: EditorView, from: number, to: number): void => {
  // Walk the range a char at a time and unify same-line coords into one
  // rect per line. CodeMirror's coordsAtPos gives {left, right, top, bottom}
  // for a caret position; we use (from..to) coords to build line rects.
  const rects: DOMRect[] = []
  const fromCoords = view.coordsAtPos(from)
  const toCoords = view.coordsAtPos(to)
  if (!fromCoords || !toCoords) return
  // Single-line case — one rect is enough.
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
    // Multi-line: fall back to the native selection range rects. After
    // dispatch + focus, the DOM selection should be in sync.
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      for (const r of sel.getRangeAt(0).getClientRects()) rects.push(r as DOMRect)
    }
  }
  renderFlash(rects)
}

/**
 * Find the N-th occurrence of `target` text inside the Tiptap editor doc
 * and select it, scrolling it into view. ProseMirror uses its own position
 * space (not source-string offsets), so we walk the doc and map the literal
 * match to pm positions. A Cmd+F-style flash highlight is drawn over the
 * matched range so the jump is visible even without editor focus.
 *
 * Returns true if the occurrence was found and selected.
 */

/**
 * Find the N-th occurrence of `target` text inside the Tiptap editor doc
 * and select it, scrolling it into view. ProseMirror uses its own position
 * space (not source-string offsets), so we walk the doc and map the literal
 * match to pm positions.
 *
 * Returns true if the occurrence was found and selected.
 */
export const jumpToVisualOccurrence = (
  editor: Editor,
  target: string,
  occurrenceIndex: number
): boolean => {
  const hits: Array<{ from: number; to: number }> = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    let searchFrom = 0
    const text = node.text
    while (searchFrom <= text.length - target.length) {
      const idx = text.indexOf(target, searchFrom)
      if (idx === -1) break
      hits.push({ from: pos + idx, to: pos + idx + target.length })
      searchFrom = idx + target.length
    }
    return false
  })
  const hit = hits[occurrenceIndex]
  if (!hit) return false
  editor.chain().focus().setTextSelection({ from: hit.from, to: hit.to }).scrollIntoView().run()
  // Flash after a rAF tick so ProseMirror has updated the DOM selection.
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
 * Return the line/snippet around a source-offset for the hover preview.
 * Trims the surrounding line to a reasonable length with the match roughly
 * centered, so long paragraphs don't overflow the tooltip.
 */
export const snippetAround = (content: string, from: number, to: number, maxLen = 80): string => {
  // Walk back/forward to the enclosing newlines so we don't span paragraphs.
  const lineStart = content.lastIndexOf('\n', from - 1) + 1
  let lineEnd = content.indexOf('\n', to)
  if (lineEnd === -1) lineEnd = content.length
  const line = content.slice(lineStart, lineEnd)
  if (line.length <= maxLen) return line
  // Crop with the match roughly centered.
  const matchStartInLine = from - lineStart
  const matchLen = to - from
  const slack = Math.max(0, maxLen - matchLen)
  const halfSlack = Math.floor(slack / 2)
  let start = Math.max(0, matchStartInLine - halfSlack)
  const end = Math.min(line.length, start + maxLen)
  if (end - start < maxLen) start = Math.max(0, end - maxLen)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < line.length ? '…' : ''
  return prefix + line.slice(start, end) + suffix
}

/**
 * Draw briefly-visible fuchsia overlays at the given viewport rects,
 * fading out over ~600ms. Used to make variable jumps obvious even when
 * the editor's native selection isn't visible (no focus, etc.).
 */
const renderFlash = (rects: DOMRect[] | Iterable<DOMRect>): void => {
  const rectList = Array.from(rects).filter((r) => r.width > 0 && r.height > 0)
  if (rectList.length === 0) return
  const overlays: HTMLElement[] = []
  for (const rect of rectList) {
    const el = document.createElement('div')
    el.className = 'smarkup-variable-flash'
    el.style.left = `${rect.left}px`
    el.style.top = `${rect.top}px`
    el.style.width = `${rect.width}px`
    el.style.height = `${rect.height}px`
    document.body.appendChild(el)
    overlays.push(el)
  }
  // Trigger the fade on the next frame so the initial opacity is painted first.
  requestAnimationFrame(() => {
    for (const el of overlays) el.classList.add('smarkup-variable-flash-fade')
  })
  setTimeout(() => {
    for (const el of overlays) el.remove()
  }, 700)
}
