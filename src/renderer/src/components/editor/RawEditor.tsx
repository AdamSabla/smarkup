import { useCallback, useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import {
  EditorView,
  keymap,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate
} from '@codemirror/view'
import { EditorSelection, RangeSetBuilder } from '@codemirror/state'
import { useWorkspace } from '@/store/workspace'

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
}

function useIsDark(): boolean {
  const theme = useWorkspace((s) => s.theme)
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return document.documentElement.classList.contains('dark')
}

const RawEditor = ({ tabId, value, onChange }: Props): React.JSX.Element => {
  const isDark = useIsDark()
  const rawHeadingSizes = useWorkspace((s) => s.rawHeadingSizes)
  const restoredRef = useRef(false)
  const saveScrollPosition = useWorkspace((s) => s.saveScrollPosition)
  const saveCursorPosition = useWorkspace((s) => s.saveCursorPosition)
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
          const target = scroller.scrollTop + dir * scroller.clientHeight * 0.85
          smoothScroll(scroller, Math.max(0, target), 300)
        }
      },
      true // capture phase — runs before CodeMirror's handler
    )

    // Restore cursor position from a previous tab visit, or place at start
    const savedCursor = useWorkspace.getState().cursorPositions[tabId] ?? null
    if (savedCursor) {
      const docLen = view.state.doc.length
      const anchor = Math.min(savedCursor.anchor, docLen)
      const head = Math.min(savedCursor.head, docLen)
      view.dispatch({ selection: EditorSelection.single(anchor, head) })
    }

    // Restore scroll using line-based anchor (survives CodeMirror virtualization).
    // Focus first with preventScroll so the browser doesn't jump to the caret,
    // then dispatch the scroll effect to land on the saved line.
    requestAnimationFrame(() => {
      view.contentDOM.focus({ preventScroll: true })
      const saved = useWorkspace.getState().scrollPositions[tabId]
      if (saved && typeof saved === 'object' && 'line' in saved) {
        const clampedLine = Math.min(saved.line, view.state.doc.lines)
        const lineInfo = view.state.doc.line(clampedLine)
        view.dispatch({
          effects: EditorView.scrollIntoView(lineInfo.from, {
            y: 'start',
            yMargin: -saved.offsetPx
          })
        })
      }
      restoredRef.current = true
    })

  }, [])

  // Persist scroll position to the store every 200ms so it's never stale.
  // (Cleanup runs after React detaches the DOM, making view.scrollDOM unreliable.)
  useEffect(() => {
    let lastLine = -1
    let lastOffset = -1
    const interval = setInterval(() => {
      if (!restoredRef.current) return
      const view = viewRef.current
      if (!view) return
      const scrollTop = view.scrollDOM.scrollTop
      const block = view.lineBlockAtHeight(scrollTop)
      const line = view.state.doc.lineAt(block.from).number
      const offsetPx = Math.round(scrollTop - block.top)
      if (line !== lastLine || offsetPx !== lastOffset) {
        lastLine = line
        lastOffset = offsetPx
        saveScrollPosition(tabId, { line, offsetPx })
      }
    }, 200)

    return () => {
      clearInterval(interval)
      const view = viewRef.current
      if (view) {
        const { anchor, head } = view.state.selection.main
        saveCursorPosition(tabId, anchor, head)
      }
    }
  }, [tabId, saveScrollPosition, saveCursorPosition])

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
      checklistKeymap,
      placeholderHighlighter,
      ...(rawHeadingSizes ? [headingHighlighter] : []),
      EditorView.lineWrapping,
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
        '.cm-cursor': {
          borderLeftColor: 'var(--foreground)'
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
    [checklistKeymap, rawHeadingSizes]
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
        highlightActiveLine: false,
        highlightActiveLineGutter: false
      }}
      className="h-full"
      height="100%"
    />
  )
}

export default RawEditor
