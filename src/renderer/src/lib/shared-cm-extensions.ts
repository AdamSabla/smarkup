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
  WidgetType,
  type ViewUpdate
} from '@codemirror/view'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { linkTargetOf, openPartial } from '@/lib/partials'

/* ------------------------------------------------------------------ */
/*  Heading syntax highlight style                                     */
/* ------------------------------------------------------------------ */

/**
 * Theme-aware markdown accent, defined in assets/main.css. Resolves to
 * red-400 under `.dark` and to the much darker red-700 in light mode, where
 * red-400 only reaches ~2.6:1 against the white background. CodeMirror emits
 * these as plain CSS rules, so the custom property inherits from <html> and
 * re-resolves on its own when the theme flips.
 */
const HEADING_RED = 'var(--syntax-accent)'

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

const isMacUA = navigator.userAgent.toLowerCase().includes('mac')
const MOD_LABEL = isMacUA ? '⌘' : 'Ctrl'

/**
 * A placeholder that names a file — an import (`{{> _shared/x}}`), or a plain
 * `{{revision}}` with a `revision.md` beside it — is treated as a link: this
 * mark carries the reference (and the file it resolved to) for the click
 * handler, and `PartialOpenWidget` puts a visible affordance next to it.
 */
const partialMark = (ref: string, path: string | null): Decoration =>
  Decoration.mark({
    class: 'cm-placeholder-highlight cm-partial-ref',
    attributes: {
      'data-partial-ref': ref,
      ...(path ? { 'data-partial-path': path } : {}),
      title: `${MOD_LABEL}-click to open ${ref}`
    }
  })

class PartialOpenWidget extends WidgetType {
  constructor(
    readonly ref: string,
    readonly path: string | null
  ) {
    super()
  }

  // Two widgets for the same target are interchangeable, so CodeMirror can
  // reuse the DOM instead of rebuilding it on every viewport update.
  eq(other: PartialOpenWidget): boolean {
    return other.ref === this.ref && other.path === this.path
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-partial-open'
    el.dataset.partialRef = this.ref
    if (this.path) el.dataset.partialPath = this.path
    el.setAttribute('role', 'button')
    el.title = `Open ${this.ref}`
    el.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>'
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * Open the referenced file when the icon is clicked, or when a placeholder is
 * mod-clicked. Bound on mousedown so the caret doesn't move first.
 */
export const partialLinkHandler = EditorView.domEventHandlers({
  mousedown: (event) => {
    const el = event.target instanceof HTMLElement ? event.target : null
    if (!el) return false
    const onIcon = !!el.closest('.cm-partial-open')
    if (!onIcon && !(isMacUA ? event.metaKey : event.ctrlKey)) return false
    const link = el.closest<HTMLElement>('[data-partial-ref]')
    const ref = link?.dataset.partialRef
    if (!ref) return false
    event.preventDefault()
    void openPartial(ref, link?.dataset.partialPath)
    return true
  }
})

/**
 * Highlight every `{{placeholder}}`, and link the ones that name a file.
 *
 * `getPath` reports the file being edited, which is what a reference resolves
 * against — a getter rather than a value so the extension list stays stable
 * across renames and tab switches.
 */
export const placeholderHighlighter = (getPath: () => string = () => ''): Extension =>
  ViewPlugin.fromClass(
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
        const fromPath = getPath()
        const re = /\{\{[^}]+\}\}/g
        let match
        while ((match = re.exec(text))) {
          const start = from + match.index
          const end = start + match[0].length
          const link = linkTargetOf(match[0], fromPath)
          builder.add(start, end, link ? partialMark(link.ref, link.path) : placeholderMark)
          if (link) {
            builder.add(
              end,
              end,
              Decoration.widget({ widget: new PartialOpenWidget(link.ref, link.path), side: 1 })
            )
          }
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
  '.cm-placeholder-highlight': {
    color: '#e879f9',
    borderRadius: '3px',
    backgroundColor: 'rgba(232, 121, 249, 0.12)'
  },
  // An import placeholder points at a file, so it gets a link's affordances:
  // an underline and a pointer while the modifier is held, plus the open icon
  // below. Both stay quiet until you're actually reaching for them.
  '.cm-partial-ref': {
    textDecorationColor: 'rgba(232, 121, 249, 0.5)'
  },
  '.cm-partial-ref:hover': {
    textDecoration: 'underline'
  },
  '.cm-partial-open': {
    display: 'inline-flex',
    alignItems: 'center',
    verticalAlign: 'text-top',
    width: '0.85em',
    height: '0.85em',
    marginLeft: '0.15em',
    color: '#e879f9',
    opacity: '0.55',
    cursor: 'pointer'
  },
  '.cm-partial-open:hover': {
    opacity: '1'
  },
  '.cm-partial-open svg': {
    width: '100%',
    height: '100%'
  },
  '.cm-inline-code-highlight': {
    color: HEADING_RED,
    borderRadius: '3px',
    backgroundColor: 'var(--syntax-accent-bg)'
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
