import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import {
  EditorView,
  drawSelection,
  keymap,
  Decoration,
  DecorationSet,
  Panel,
  ViewPlugin,
  ViewUpdate,
  showPanel
} from '@codemirror/view'
import { Prec, RangeSetBuilder } from '@codemirror/state'
import { syntaxHighlighting } from '@codemirror/language'
import { search } from '@codemirror/search'
import { useWorkspace } from '@/store/workspace'
import { getActiveRawEditor, setActiveRawEditor } from '@/lib/active-raw-editor'
import {
  markdownHighlight,
  placeholderHighlighter,
  inlineCodeHighlighter,
  todoCommentHighlighter,
  sharedEditorTokenTheme
} from '@/lib/shared-cm-extensions'

const headingDecos = [
  Decoration.line({ attributes: { class: 'cm-heading-1' } }),
  Decoration.line({ attributes: { class: 'cm-heading-2' } }),
  Decoration.line({ attributes: { class: 'cm-heading-3' } }),
  Decoration.line({ attributes: { class: 'cm-heading-4' } })
]

const headingHighlighter = ViewPlugin.fromClass(
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
        const match = line.text.match(/^(#{1,4})\s/)
        if (match) {
          builder.add(line.from, line.from, headingDecos[match[1].length - 1])
        }
        pos = line.to + 1
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

// ---------------------------------------------------------------------------
// Sticky heading breadcrumb
// ---------------------------------------------------------------------------
// As the user scrolls down, the heading hierarchy of the current position
// stacks at the top of the editor — H1 first, then H2 under it, etc., down
// to whatever level the cursor is currently nested in. Clicking a row jumps
// the editor back to that heading. Disabled when scaled headings is on,
// since stacking lines of wildly different sizes looks chaotic.
//
// Implementation: a CodeMirror Panel (sits above scrollDOM, doesn't shift
// content). Heading list is built once per doc edit by walking the lezer
// syntax tree, so headings inside fenced code blocks aren't picked up.
// Active chain is recomputed on scroll (rAF-throttled) and on viewport
// updates; DOM is only re-rendered when the chain actually changes.

type HeadingEntry = {
  level: number // 1–6
  text: string // display text, with `#` markers stripped
  pos: number // line.from of the heading line (for scrollIntoView)
  lineNumber: number // 1-indexed
}

const HEADING_LINE_RE = /^(#{1,6})\s+(.*)$/

const collectHeadings = (view: EditorView): HeadingEntry[] => {
  // Per-line regex scan. We deliberately don't use lezer's syntax tree here
  // because it parses lazily — right after a big doc swap (paste, file load)
  // the ATX heading nodes may not exist yet, leaving the breadcrumb empty
  // until the next edit. The cost of regex scanning the whole doc on every
  // edit is negligible (microseconds) and matches what `headingHighlighter`
  // already does for syntax coloring.
  const out: HeadingEntry[] = []
  const doc = view.state.doc
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const m = line.text.match(HEADING_LINE_RE)
    if (!m) continue
    const body = m[2].trim()
    out.push({
      level: m[1].length,
      // Keep the `#` markers in the rendered text so the breadcrumb mirrors
      // the source line (matches the user's mental model of "this is the
      // heading I just scrolled past"). Non-breaking space when the heading
      // is empty so the row still has a clickable target.
      text: body ? `${m[1]} ${body}` : `${m[1]}\u00a0`,
      pos: line.from,
      lineNumber: line.number
    })
  }
  return out
}

const stickyChainsEqual = (a: HeadingEntry[], b: HeadingEntry[]): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].pos !== b[i].pos || a[i].text !== b[i].text) return false
  }
  return true
}

const stickyHeadingPanel = (view: EditorView): Panel => {
  const dom = document.createElement('div')
  dom.className = 'cm-sticky-stack'
  dom.style.display = 'none'

  let headings = collectHeadings(view)
  let lastChain: HeadingEntry[] = []
  let renderPending = false

  const computeChain = (): HeadingEntry[] => {
    const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
    const firstVisibleLine = view.state.doc.lineAt(block.from).number
    const chain: HeadingEntry[] = []
    for (const h of headings) {
      if (h.lineNumber >= firstVisibleLine) break
      // A new heading at level L invalidates any existing chain entry at
      // level >= L (those are now siblings or descendants of a new scope).
      while (chain.length > 0 && chain[chain.length - 1].level >= h.level) chain.pop()
      chain.push(h)
    }
    return chain
  }

  const renderNow = (): void => {
    renderPending = false
    const chain = computeChain()
    if (stickyChainsEqual(chain, lastChain)) return
    lastChain = chain

    dom.replaceChildren()
    for (const h of chain) {
      const row = document.createElement('div')
      row.className = 'cm-sticky-line'
      row.dataset.level = String(h.level)
      row.textContent = h.text
      row.title = h.text
      // mousedown + preventDefault keeps editor focus and prevents the
      // click from moving the caret — pure scroll, matching Home/End.
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        view.dispatch({
          effects: EditorView.scrollIntoView(h.pos, { y: 'start', yMargin: 4 })
        })
      })
      dom.appendChild(row)
    }
    dom.style.display = chain.length === 0 ? 'none' : ''
  }

  // Defer renders to a microtask so they always run *after* the current
  // CodeMirror update/measure cycle exits — `lineBlockAtHeight` will throw
  // "Reading the editor layout isn't allowed during an update" otherwise.
  // Microtasks (unlike rAF) aren't throttled when the tab is backgrounded,
  // and they coalesce naturally because we early-return when one is queued.
  const scheduleRender = (): void => {
    if (renderPending) return
    renderPending = true
    queueMicrotask(renderNow)
  }

  view.scrollDOM.addEventListener('scroll', scheduleRender, { passive: true })
  scheduleRender() // initial paint

  return {
    dom,
    top: true,
    update(update) {
      if (update.docChanged) {
        headings = collectHeadings(update.view)
      }
      if (update.docChanged || update.geometryChanged || update.viewportChanged) {
        scheduleRender()
      }
    },
    destroy() {
      view.scrollDOM.removeEventListener('scroll', scheduleRender)
    }
  }
}

const stickyHeadingBreadcrumb = showPanel.of(stickyHeadingPanel)

type Props = {
  tabId: string
  value: string
  onChange: (value: string) => void
  isActive: boolean
}

function useIsDark(): boolean {
  const theme = useWorkspace((s) => s.theme)
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return document.documentElement.classList.contains('dark')
}

const RawEditor = ({ value, onChange, isActive }: Props): React.JSX.Element => {
  const isDark = useIsDark()
  const rawHeadingSizes = useWorkspace((s) => s.rawHeadingSizes)
  const rawWordWrap = useWorkspace((s) => s.rawWordWrap)
  const viewRef = useRef<EditorView | null>(null)
  // Mirror of viewRef as state — CodeMirror's `onCreateEditor` fires in a
  // later effect pass than RawEditor's own useEffect, so a pure ref would
  // leave our "register as active editor" effect running with viewRef still
  // null on initial mount (and never re-running). Tracking readiness as
  // state retriggers the effect once the view actually exists.
  const [viewReady, setViewReady] = useState(false)

  const onCreateEditor = useCallback((view: EditorView) => {
    viewRef.current = view
    setViewReady(true)

    // Intercept Home/End/PageUp/PageDown before CodeMirror's keymap sees them.
    // Smooth-scroll the document without moving the caret, matching visual editor behaviour.
    let scrollAnim = 0
    const smoothScroll = (el: HTMLElement, target: number, duration: number): void => {
      cancelAnimationFrame(scrollAnim)
      const start = el.scrollTop
      const delta = target - start
      if (Math.abs(delta) < 1) {
        el.scrollTop = target
        return
      }
      const t0 = performance.now()
      const step = (now: number): void => {
        const p = Math.min((now - t0) / duration, 1)
        const ease = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2
        el.scrollTop = start + delta * ease
        if (p < 1) scrollAnim = requestAnimationFrame(step)
      }
      scrollAnim = requestAnimationFrame(step)
    }
    view.dom.addEventListener(
      'keydown',
      (e) => {
        const scroller = view.scrollDOM
        if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault()
          e.stopPropagation()
          const target = e.key === 'Home' ? 0 : scroller.scrollHeight - scroller.clientHeight
          smoothScroll(scroller, target, 300)
        } else if (e.key === 'PageUp' || e.key === 'PageDown') {
          e.preventDefault()
          e.stopPropagation()
          const dir = e.key === 'PageDown' ? 1 : -1
          // Smooth-scroll by ~one viewport (minus a small overlap so context
          // carries over). Short duration keeps it responsive while taking
          // the edge off the instant jump.
          const maxScroll = scroller.scrollHeight - scroller.clientHeight
          const target = Math.max(
            0,
            Math.min(maxScroll, scroller.scrollTop + dir * (scroller.clientHeight - 40))
          )
          smoothScroll(scroller, target, 180)
        }
      },
      true // capture phase — runs before CodeMirror's handler
    )

    // Initial focus
    requestAnimationFrame(() => {
      view.contentDOM.focus({ preventScroll: true })
    })
  }, [])

  // Focus and recalculate viewport when this tab becomes active.
  // The editor stays mounted (DOM + scroll preserved) so no restore is needed.
  // `viewReady` is included in the dep list so this runs once the CodeMirror
  // view has actually been constructed (see viewReady declaration above).
  useEffect(() => {
    const view = viewRef.current
    if (!view || !isActive) return
    view.requestMeasure()
    view.contentDOM.focus({ preventScroll: true })
    setActiveRawEditor(view)
    return () => {
      if (getActiveRawEditor() === view) setActiveRawEditor(null)
    }
  }, [isActive, viewReady])

  const checklistKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: 'Mod-Shift-l',
          run: (view) => {
            const { state } = view
            const { from, to } = state.selection.main
            const changes: { from: number; to: number; insert: string }[] = []

            for (let pos = from; pos <= to; ) {
              const line = state.doc.lineAt(pos)
              const text = line.text
              const checklistRe = /^(\s*)- \[[ x]\] /i
              const listRe = /^(\s*)- /
              const indentRe = /^(\s*)/

              if (checklistRe.test(text)) {
                const m = text.match(checklistRe)!
                changes.push({
                  from: line.from + m[1].length,
                  to: line.from + m[0].length,
                  insert: ''
                })
              } else if (listRe.test(text)) {
                const m = text.match(listRe)!
                changes.push({
                  from: line.from + m[1].length,
                  to: line.from + m[0].length,
                  insert: '- [ ] '
                })
              } else {
                const m = text.match(indentRe)!
                changes.push({
                  from: line.from + m[1].length,
                  to: line.from + m[1].length,
                  insert: '- [ ] '
                })
              }
              pos = line.to + 1
            }

            if (changes.length > 0) view.dispatch({ changes })
            return true
          }
        },
        {
          key: 'Mod-Enter',
          run: (view) => {
            const { state } = view
            const { from, to } = state.selection.main
            const changes: { from: number; to: number; insert: string }[] = []

            for (let pos = from; pos <= to; ) {
              const line = state.doc.lineAt(pos)
              const text = line.text
              const unchecked = text.match(/^(\s*)- \[ \] /)
              const checked = text.match(/^(\s*)- \[x\] /i)

              if (unchecked) {
                const start = line.from + unchecked[1].length
                changes.push({ from: start, to: start + 6, insert: '- [x] ' })
              } else if (checked) {
                const start = line.from + checked[1].length
                changes.push({ from: start, to: start + 6, insert: '- [ ] ' })
              }
              pos = line.to + 1
            }

            if (changes.length > 0) {
              view.dispatch({ changes })
              return true
            }
            return false
          }
        }
      ]),
    []
  )

  const extensions = useMemo(
    () => [
      markdown(),
      // Wrap in `Prec.highest` so our heading highlight overrides the
      // highlight style the `@uiw/react-codemirror` built-in theme ships
      // (which colors heading text red in dark mode).
      Prec.highest(syntaxHighlighting(markdownHighlight)),
      // Disable caret blinking. `Prec.high` so it wins over the default
      // drawSelection that basicSetup ships with.
      Prec.high(drawSelection({ cursorBlinkRate: 0 })),
      checklistKeymap,
      placeholderHighlighter,
      inlineCodeHighlighter,
      todoCommentHighlighter,
      // Provide the search state field (decorations, current match) without
      // the panel. We drive it via setSearchQuery / findNext from our own
      // FindBar — basicSetup's searchKeymap is disabled below so Cmd+F never
      // reaches CM6's default `openSearchPanel` handler.
      search({ top: true }),
      ...(rawHeadingSizes ? [headingHighlighter] : [stickyHeadingBreadcrumb]),
      ...(rawWordWrap ? [EditorView.lineWrapping] : []),
      sharedEditorTokenTheme,
      EditorView.theme({
        '&': {
          fontSize: '14px',
          height: '100%',
          backgroundColor: 'var(--background) !important',
          color: 'var(--foreground) !important'
        },
        '.cm-scroller': {
          fontFamily:
            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
          padding: '40px 48px'
        },
        '.cm-content': {
          caretColor: 'var(--foreground)'
        },
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'var(--foreground)',
          borderLeftWidth: '2px',
          marginTop: '-1px',
          height: 'calc(1em + 4px) !important'
        },
        '.cm-activeLine': {
          backgroundColor: 'color-mix(in srgb, var(--foreground) 6%, transparent)',
          boxShadow: 'inset 10px 0 0 color-mix(in srgb, var(--foreground) 40%, transparent)',
          marginLeft: '-48px',
          paddingLeft: '54px'
        },
        '.cm-gutters': {
          backgroundColor: 'var(--background) !important',
          borderRight: 'none'
        },
        '&.cm-focused': {
          outline: 'none'
        },
        '.cm-heading-1': { fontSize: '2.4em', lineHeight: '1.3', fontWeight: '700' },
        '.cm-heading-2': { fontSize: '2.0em', lineHeight: '1.3', fontWeight: '600' },
        '.cm-heading-3': { fontSize: '1.7em', lineHeight: '1.3', fontWeight: '600' },
        '.cm-heading-4': { fontSize: '1.55em', lineHeight: '1.3', fontWeight: '600' }
      })
    ],
    [checklistKeymap, rawHeadingSizes, rawWordWrap]
  )

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      onCreateEditor={onCreateEditor}
      theme={isDark ? 'dark' : 'light'}
      extensions={extensions}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: true,
        highlightActiveLineGutter: false,
        // Suppress CM6's built-in search keymap (Cmd+F → openSearchPanel) and
        // the panel it ships. We render our own FindBar UI and drive the
        // search state field directly via `setSearchQuery` / `findNext`.
        searchKeymap: false
      }}
      className="h-full"
      height="100%"
    />
  )
}

export default RawEditor
