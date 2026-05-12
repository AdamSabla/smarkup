/**
 * CodeMirror extensions shared between RawEditor and DiffView.
 * Heading-specific extensions (headingHighlighter, stickyHeadingBreadcrumb)
 * stay in RawEditor since they're specific to regular editing.
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate
} from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/* ------------------------------------------------------------------ */
/*  Heading syntax highlight style                                     */
/* ------------------------------------------------------------------ */

const HEADING_RED = '#f87171' // tailwind red-400

export const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading1, color: HEADING_RED, fontWeight: '700' },
  { tag: tags.heading2, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading3, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading4, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading5, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading6, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.processingInstruction, color: HEADING_RED },
  { tag: tags.strong, color: HEADING_RED, fontWeight: '700' }
])

/* ------------------------------------------------------------------ */
/*  Decoration marks                                                   */
/* ------------------------------------------------------------------ */

const placeholderMark = Decoration.mark({ class: 'cm-placeholder-highlight' })
const inlineCodeMark = Decoration.mark({ class: 'cm-inline-code-highlight' })
const commentMark = Decoration.mark({ class: 'cm-comment-highlight' })
const todoMark = Decoration.mark({ class: 'cm-todo-highlight' })

/* ------------------------------------------------------------------ */
/*  ViewPlugin highlighters                                            */
/* ------------------------------------------------------------------ */

export const placeholderHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()
      const { from, to } = view.viewport
      const text = view.state.doc.sliceString(from, to)
      const re = /\{\{[^}]+\}\}/g
      let match
      while ((match = re.exec(text))) {
        builder.add(from + match.index, from + match.index + match[0].length, placeholderMark)
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

export const inlineCodeHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()
      const { from, to } = view.viewport
      const text = view.state.doc.sliceString(from, to)
      const re = /(?<!`)`[^`\n]+`(?!`)/g
      let match
      while ((match = re.exec(text))) {
        builder.add(from + match.index, from + match.index + match[0].length, inlineCodeMark)
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

export const todoCommentHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    build(view: EditorView): DecorationSet {
      const { from, to } = view.viewport
      const text = view.state.doc.sliceString(from, to)
      type Hit = { from: number; to: number; deco: Decoration; order: number }
      const hits: Hit[] = []
      const commentRe = /(?<!:)\/\/[^\n]*/g
      let m: RegExpExecArray | null
      while ((m = commentRe.exec(text))) {
        hits.push({
          from: from + m.index,
          to: from + m.index + m[0].length,
          deco: commentMark,
          order: 0
        })
      }
      const todoRe = /\bTODO(?::\{[^}]*\})?(?!\w)/g
      while ((m = todoRe.exec(text))) {
        hits.push({
          from: from + m.index,
          to: from + m.index + m[0].length,
          deco: todoMark,
          order: 1
        })
      }
      hits.sort((a, b) => a.from - b.from || a.order - b.order)
      const builder = new RangeSetBuilder<Decoration>()
      for (const h of hits) builder.add(h.from, h.to, h.deco)
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

/* ------------------------------------------------------------------ */
/*  List hang-indent — wrapped list items align under the marker text  */
/* ------------------------------------------------------------------ */

// Matches leading whitespace + a list marker. The capture's length is the
// number of `ch` to hang-indent wrapped lines by, so the wrapped portion
// aligns under the content after the marker rather than flushing left.
//
// Marker forms covered:
//   - bullet:   `- `, `* `, `+ `
//   - ordered:  `1. `, `12) `
//   - task:     `- [ ] `, `- [x] `  (after a bullet, optional)
const LIST_MARKER_RE = /^(\s*(?:[-*+]|\d+[.)])\s(?:\[[ xX]\]\s)?)/

export const listHangIndentPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>()
      const { from, to } = view.viewport
      for (let pos = from; pos <= to; ) {
        const line = view.state.doc.lineAt(pos)
        const m = line.text.match(LIST_MARKER_RE)
        if (m) {
          const offset = m[1].length
          builder.add(
            line.from,
            line.from,
            Decoration.line({ attributes: { style: `--cm-hang: ${offset}ch` } })
          )
        }
        pos = line.to + 1
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

/* ------------------------------------------------------------------ */
/*  TODO auto-bracket — `TODO:` → `TODO:{|}`                           */
/* ------------------------------------------------------------------ */

/**
 * When the user types `:` immediately after a standalone `TODO`, expand the
 * insertion to `:{}` and place the caret between the braces so the user can
 * start typing the description body without balancing braces. Mirrors the
 * Tiptap `todoAutoBracketKey` plugin so both editors behave identically.
 */
export const todoColonAutoBracket = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ':' || from !== to) return false
  const start = Math.max(0, from - 5)
  const before = view.state.doc.sliceString(start, from)
  if (!/(?:^|\W)TODO$/.test(before)) return false
  view.dispatch({
    changes: { from, to, insert: ':{}' },
    selection: { anchor: from + 2 },
    userEvent: 'input.type'
  })
  return true
})

/* ------------------------------------------------------------------ */
/*  Shared editor theme (token styling — not layout/padding)           */
/* ------------------------------------------------------------------ */

export const sharedEditorTokenTheme = EditorView.theme({
  // Hang-indent for soft-wrapped list items. The `listHangIndentPlugin`
  // sets `--cm-hang` per list line as an inline style; non-list lines (and
  // every line when the plugin is disabled) fall back to `0px`, so this
  // rule is a no-op outside list contexts.
  '.cm-line': {
    paddingInlineStart: 'var(--cm-hang, 0px)',
    textIndent: 'calc(-1 * var(--cm-hang, 0px))'
  },
  '.cm-placeholder-highlight': {
    color: '#e879f9',
    borderRadius: '3px',
    backgroundColor: 'rgba(232, 121, 249, 0.12)'
  },
  '.cm-inline-code-highlight': {
    color: '#f87171',
    borderRadius: '3px',
    backgroundColor: 'rgba(248, 113, 113, 0.12)'
  },
  '.cm-comment-highlight': {
    color: '#9ca3af',
    fontStyle: 'italic'
  },
  '.cm-todo-highlight': {
    backgroundColor: '#facc15',
    color: '#000',
    fontWeight: '700',
    borderRadius: '4px',
    padding: '0 4px'
  }
})
