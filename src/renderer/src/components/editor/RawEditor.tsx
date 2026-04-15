import { useCallback, useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import {
  EditorView,
  drawSelection,
  keymap,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate
} from '@codemirror/view'
import { Prec, RangeSetBuilder } from '@codemirror/state'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { useWorkspace } from '@/store/workspace'

// Unify heading syntax coloring: the marker (`#`, `##`, …) and the heading
// text share the same red instead of the default theme's two-tone look
// (green marker + red text). Red reads as more attention-grabbing than the
// green we tried first. We hit both the generic `heading` tag (which
// lezer-markdown applies to the whole heading including content) and each
// specific level, so the rule wins regardless of which tag the outer theme
// happens to match.
const HEADING_RED = '#f87171' // tailwind red-400 — reads well on both themes
const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading1, color: HEADING_RED, fontWeight: '700' },
  { tag: tags.heading2, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading3, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading4, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading5, color: HEADING_RED, fontWeight: '600' },
  { tag: tags.heading6, color: HEADING_RED, fontWeight: '600' },
  // `processingInstruction` is the tag lezer-markdown uses for the `#`
  // marker itself — include it so it doesn't fall back to the theme's
  // marker color.
  { tag: tags.processingInstruction, color: HEADING_RED }
])

const placeholderMark = Decoration.mark({ class: 'cm-placeholder-highlight' })

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

const placeholderHighlighter = ViewPlugin.fromClass(
  class {
    decorations

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

  const onCreateEditor = useCallback((view: EditorView) => {
    viewRef.current = view

    // Intercept Home/End/PageUp/PageDown before CodeMirror's keymap sees them.
    // Smooth-scroll the document without moving the caret, matching visual editor behaviour.
    let scrollAnim = 0
    const smoothScroll = (el: HTMLElement, target: number, duration: number): void => {
      cancelAnimationFrame(scrollAnim)
      const start = el.scrollTop
      const delta = target - start
      if (Math.abs(delta) < 1) { el.scrollTop = target; return }
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
  useEffect(() => {
    const view = viewRef.current
    if (!view || !isActive) return
    view.requestMeasure()
    view.contentDOM.focus({ preventScroll: true })
  }, [isActive])

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
      ...(rawHeadingSizes ? [headingHighlighter] : []),
      ...(rawWordWrap ? [EditorView.lineWrapping] : []),
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
        // Thicker, taller, non-blinking caret. Negative margin + extra height
        // stretches it ~2px beyond the line-box so it reads as a bolder bar.
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: 'var(--foreground)',
          borderLeftWidth: '2px',
          marginTop: '-1px',
          height: 'calc(1em + 4px) !important'
        },
        // Active-line indicator — subtle background plus a Sublime-style
        // colored bar flush against the left edge of the editor. Negative
        // margin-left pulls the highlight into the scroller's 48px left
        // padding so the rectangle runs all the way to the edge. The
        // paddingLeft restores the 48px shift *and* preserves the default
        // 6px padding `.cm-line` ships with, so text stays aligned with
        // inactive lines.
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
        '.cm-placeholder-highlight': {
          color: '#e879f9',
          borderRadius: '3px',
          backgroundColor: 'rgba(232, 121, 249, 0.12)'
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
        highlightActiveLineGutter: false
      }}
      className="h-full"
      height="100%"
    />
  )
}

export default RawEditor
