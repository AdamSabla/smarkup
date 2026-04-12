import { useCallback, useEffect, useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView, keymap } from '@codemirror/view'
import { useWorkspace } from '@/store/workspace'

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
  const lastScrollTop = useRef(0)
  const initialScroll = useRef(useWorkspace.getState().scrollPositions[tabId] ?? 0)
  const saveScrollPosition = useWorkspace((s) => s.saveScrollPosition)

  const onCreateEditor = useCallback((view: EditorView) => {
    if (initialScroll.current) {
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = initialScroll.current
        lastScrollTop.current = initialScroll.current
      })
    }

    const onScroll = (): void => {
      lastScrollTop.current = view.scrollDOM.scrollTop
    }
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
  }, [])

  useEffect(() => {
    return () => {
      saveScrollPosition(tabId, lastScrollTop.current)
    }
  }, [tabId, saveScrollPosition])

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
        }
      })
    ],
    [checklistKeymap]
  )

  return (
    <CodeMirror
      autoFocus
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
