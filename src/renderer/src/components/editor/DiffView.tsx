import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { syntaxHighlighting } from '@codemirror/language'
import { selectNextOccurrence } from '@codemirror/search'
import { cn } from '@/lib/utils'
import { useWorkspace, type DiffTab } from '@/store/workspace'
import { computeDiff, buildAlignmentMap, type DiffResult, type DiffHunk } from '@/lib/diff-engine'
import {
  createDiffExtension,
  setDiffDecorations,
  buildSideDecorations
} from '@/lib/diff-extensions'
import {
  markdownHighlight,
  placeholderHighlighter,
  inlineCodeHighlighter,
  todoCommentHighlighter,
  sharedEditorTokenTheme
} from '@/lib/shared-cm-extensions'
import FileSearchPopover from '@/components/FileSearchPopover'
import DiffStatusBar from './DiffStatusBar'

const DND_MIME = 'application/x-smarkup-sidebar-item'
const MD_EXT_RE = /\.md$/i

type Props = {
  diffTab: DiffTab
  isActive: boolean
}

function useIsDark(): boolean {
  const theme = useWorkspace((s) => s.theme)
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return document.documentElement.classList.contains('dark')
}

const DiffView = ({ diffTab }: Props): React.JSX.Element => {
  const isDark = useIsDark()
  const rawWordWrap = useWorkspace((s) => s.rawWordWrap)
  const tabs = useWorkspace((s) => s.tabs)
  const updateTabContent = useWorkspace((s) => s.updateTabContent)
  const saveTab = useWorkspace((s) => s.saveTab)
  const closeDiffTab = useWorkspace((s) => s.closeDiffTab)
  const swapDiffSides = useWorkspace((s) => s.swapDiffSides)
  const replaceDiffFile = useWorkspace((s) => s.replaceDiffFile)
  const autoSave = useWorkspace((s) => s.autoSave)
  const autoSaveDelayMs = useWorkspace((s) => s.autoSaveDelayMs)

  const leftTab = tabs.find((t) => t.path === diffTab.leftPath)
  const rightTab = tabs.find((t) => t.path === diffTab.rightPath)
  const leftContent = leftTab?.content ?? ''
  const rightContent = rightTab?.content ?? ''

  const leftViewRef = useRef<EditorView | null>(null)
  const rightViewRef = useRef<EditorView | null>(null)
  const focusedSideRef = useRef<'left' | 'right'>('left')
  const syncingRef = useRef(false)

  // Incremented when each editor mounts so the decoration effect re-fires
  // after both CodeMirror instances are ready.
  const [editorsReady, setEditorsReady] = useState(0)

  // Auto-save timers
  const leftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rightSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Deferred values for responsive typing during diff computation
  const deferredLeft = useDeferredValue(leftContent)
  const deferredRight = useDeferredValue(rightContent)

  const diff = useMemo<DiffResult>(
    () => computeDiff(deferredLeft, deferredRight),
    [deferredLeft, deferredRight]
  )

  const alignment = useMemo(() => {
    const leftLines = deferredLeft.split('\n').length
    const rightLines = deferredRight.split('\n').length
    return buildAlignmentMap(diff.hunks, leftLines, rightLines)
  }, [diff, deferredLeft, deferredRight])

  // Push diff decorations to both editors when diff result changes
  useEffect(() => {
    const leftView = leftViewRef.current
    const rightView = rightViewRef.current
    if (!leftView || !rightView) return

    const leftDecos = buildSideDecorations(diff, 'left')
    const rightDecos = buildSideDecorations(diff, 'right')

    leftView.dispatch({ effects: setDiffDecorations.of(leftDecos) })
    rightView.dispatch({ effects: setDiffDecorations.of(rightDecos) })
  }, [diff, editorsReady])

  // Scroll synchronisation
  useEffect(() => {
    const leftView = leftViewRef.current
    const rightView = rightViewRef.current
    if (!leftView || !rightView) return

    const syncScroll = (source: EditorView, target: EditorView, map: number[]): void => {
      if (syncingRef.current) return
      syncingRef.current = true
      try {
        const scrollTop = source.scrollDOM.scrollTop
        const block = source.lineBlockAtHeight(scrollTop)
        const sourceLine = source.state.doc.lineAt(block.from).number - 1 // 0-based
        const targetLine = sourceLine < map.length ? map[sourceLine] : (map[map.length - 1] ?? 0)
        if (targetLine >= 0 && targetLine < target.state.doc.lines) {
          const targetPos = target.state.doc.line(targetLine + 1).from
          const targetBlock = target.lineBlockAt(targetPos)
          target.scrollDOM.scrollTop = targetBlock.top
        }
      } catch {
        // Ignore measurement errors during transitions
      }
      // Use rAF to release the sync lock after the target's scroll event fires
      requestAnimationFrame(() => {
        syncingRef.current = false
      })
    }

    const onLeftScroll = (): void => syncScroll(leftView, rightView, alignment.leftToRight)
    const onRightScroll = (): void => syncScroll(rightView, leftView, alignment.rightToLeft)

    leftView.scrollDOM.addEventListener('scroll', onLeftScroll, { passive: true })
    rightView.scrollDOM.addEventListener('scroll', onRightScroll, { passive: true })

    return () => {
      leftView.scrollDOM.removeEventListener('scroll', onLeftScroll)
      rightView.scrollDOM.removeEventListener('scroll', onRightScroll)
    }
  }, [alignment])

  // Auto-save for both sides
  useEffect(() => {
    if (!autoSave || !leftTab) return
    if (leftTab.content === leftTab.savedContent) return
    if (leftSaveTimer.current) clearTimeout(leftSaveTimer.current)
    leftSaveTimer.current = setTimeout(() => {
      leftSaveTimer.current = null
      void saveTab(leftTab.id)
    }, autoSaveDelayMs)
    return () => {
      if (leftSaveTimer.current) {
        clearTimeout(leftSaveTimer.current)
        leftSaveTimer.current = null
      }
    }
  }, [autoSave, autoSaveDelayMs, leftTab?.content, leftTab?.savedContent])

  useEffect(() => {
    if (!autoSave || !rightTab) return
    if (rightTab.content === rightTab.savedContent) return
    if (rightSaveTimer.current) clearTimeout(rightSaveTimer.current)
    rightSaveTimer.current = setTimeout(() => {
      rightSaveTimer.current = null
      void saveTab(rightTab.id)
    }, autoSaveDelayMs)
    return () => {
      if (rightSaveTimer.current) {
        clearTimeout(rightSaveTimer.current)
        rightSaveTimer.current = null
      }
    }
  }, [autoSave, autoSaveDelayMs, rightTab?.content, rightTab?.savedContent])

  // Cmd+S keymap to save focused side
  const saveKeymap = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/rules-of-hooks
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            const tabId = focusedSideRef.current === 'left' ? leftTab?.id : rightTab?.id
            if (tabId) void saveTab(tabId)
            return true
          }
        }
      ]),
    [leftTab?.id, rightTab?.id, saveTab]
  )

  const baseExtensions = useMemo(
    () => [
      markdown(),
      Prec.highest(syntaxHighlighting(markdownHighlight)),
      Prec.high(drawSelection({ cursorBlinkRate: 0 })),
      placeholderHighlighter,
      inlineCodeHighlighter,
      todoCommentHighlighter,
      sharedEditorTokenTheme,
      createDiffExtension(),
      lineNumbers(),
      saveKeymap,
      // Re-bind Cmd-D → selectNextOccurrence. basicSetup.searchKeymap is
      // disabled on both sides, which also drops the default Cmd-D binding.
      Prec.highest(keymap.of([{ key: 'Mod-d', run: selectNextOccurrence, preventDefault: true }])),
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
          padding: '16px 20px'
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
          backgroundColor: 'color-mix(in srgb, var(--foreground) 4%, transparent)'
        },
        '.cm-gutters': {
          backgroundColor: 'var(--background) !important',
          borderRight: 'none'
        },
        '.cm-lineNumbers .cm-gutterElement': {
          color: 'color-mix(in srgb, var(--foreground) 30%, transparent)',
          fontSize: '12px',
          minWidth: '2.5em',
          padding: '0 8px 0 4px'
        },
        '.cm-lineNumbers .cm-activeLineGutter': {
          color: 'var(--foreground)'
        },
        '&.cm-focused': {
          outline: 'none'
        }
      })
    ],
    [saveKeymap, rawWordWrap]
  )

  const onLeftChange = useCallback(
    (val: string) => {
      if (leftTab) updateTabContent(leftTab.id, val)
    },
    [leftTab?.id, updateTabContent]
  )

  const onRightChange = useCallback(
    (val: string) => {
      if (rightTab) updateTabContent(rightTab.id, val)
    },
    [rightTab?.id, updateTabContent]
  )

  // Hunk navigation
  const diffHunks = diff.hunks.filter((h) => h.type !== 'equal')

  const scrollToHunk = useCallback((hunk: DiffHunk) => {
    const leftView = leftViewRef.current
    const rightView = rightViewRef.current
    if (!leftView || !rightView) return

    if ('leftStart' in hunk) {
      const line = Math.min(hunk.leftStart + 1, leftView.state.doc.lines)
      const pos = leftView.state.doc.line(line).from
      leftView.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    }
    if ('rightStart' in hunk) {
      const line = Math.min(hunk.rightStart + 1, rightView.state.doc.lines)
      const pos = rightView.state.doc.line(line).from
      rightView.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
    }
  }, [])

  const currentHunkRef = useRef(0)

  const goToNextHunk = useCallback(() => {
    if (diffHunks.length === 0) return
    currentHunkRef.current = (currentHunkRef.current + 1) % diffHunks.length
    scrollToHunk(diffHunks[currentHunkRef.current])
  }, [diffHunks, scrollToHunk])

  const goToPrevHunk = useCallback(() => {
    if (diffHunks.length === 0) return
    currentHunkRef.current = (currentHunkRef.current - 1 + diffHunks.length) % diffHunks.length
    scrollToHunk(diffHunks[currentHunkRef.current])
  }, [diffHunks, scrollToHunk])

  const leftDirty = leftTab ? leftTab.content !== leftTab.savedContent : false
  const rightDirty = rightTab ? rightTab.content !== rightTab.savedContent : false

  // --- Drop zone state & handlers ---
  const [leftDragOver, setLeftDragOver] = useState(false)
  const [rightDragOver, setRightDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Accept sidebar drags and Finder file drags
    if (e.dataTransfer.types.includes(DND_MIME) || e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent, side: 'left' | 'right') => {
      e.preventDefault()
      setLeftDragOver(false)
      setRightDragOver(false)

      // Sidebar drag
      const sidebarData = e.dataTransfer.getData(DND_MIME)
      if (sidebarData) {
        try {
          const payload = JSON.parse(sidebarData) as { kind: string; path: string }
          if (payload.kind === 'file' && MD_EXT_RE.test(payload.path)) {
            void replaceDiffFile(diffTab.id, side, payload.path)
          }
        } catch {
          /* ignore malformed data */
        }
        return
      }

      // Finder drag (native files)
      const files = e.dataTransfer.files
      if (files.length > 0) {
        const file = files[0]
        const path = window.api.getPathForFile(file)
        if (path && MD_EXT_RE.test(path)) {
          void replaceDiffFile(diffTab.id, side, path)
        }
      }
    },
    [diffTab.id, replaceDiffFile]
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {/* Left side */}
        <div
          className={cn(
            'flex flex-1 flex-col overflow-hidden border-r border-border',
            leftDragOver && 'ring-2 ring-inset ring-ring'
          )}
          onFocus={() => {
            focusedSideRef.current = 'left'
          }}
          onDragOver={handleDragOver}
          onDragEnter={(e) => {
            if (e.dataTransfer.types.includes(DND_MIME) || e.dataTransfer.types.includes('Files'))
              setLeftDragOver(true)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node))
              setLeftDragOver(false)
          }}
          onDrop={(e) => void handleDrop(e, 'left')}
        >
          <div className="flex h-7 shrink-0 items-center border-b border-border px-1.5 text-xs text-muted-foreground">
            {leftDirty && (
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-foreground/50" />
            )}
            <FileSearchPopover
              value={diffTab.leftPath}
              onSelect={(path) => void replaceDiffFile(diffTab.id, 'left', path)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeMirror
              value={leftContent}
              onChange={onLeftChange}
              onCreateEditor={(view) => {
                leftViewRef.current = view
                setEditorsReady((c) => c + 1)
              }}
              theme={isDark ? 'dark' : 'light'}
              extensions={baseExtensions}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                searchKeymap: false
              }}
              className="h-full"
              height="100%"
            />
          </div>
        </div>

        {/* Right side */}
        <div
          className={cn(
            'flex flex-1 flex-col overflow-hidden',
            rightDragOver && 'ring-2 ring-inset ring-ring'
          )}
          onFocus={() => {
            focusedSideRef.current = 'right'
          }}
          onDragOver={handleDragOver}
          onDragEnter={(e) => {
            if (e.dataTransfer.types.includes(DND_MIME) || e.dataTransfer.types.includes('Files'))
              setRightDragOver(true)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node))
              setRightDragOver(false)
          }}
          onDrop={(e) => void handleDrop(e, 'right')}
        >
          <div className="flex h-7 shrink-0 items-center border-b border-border px-1.5 text-xs text-muted-foreground">
            {rightDirty && (
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-foreground/50" />
            )}
            <FileSearchPopover
              value={diffTab.rightPath}
              onSelect={(path) => void replaceDiffFile(diffTab.id, 'right', path)}
              align="right"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CodeMirror
              value={rightContent}
              onChange={onRightChange}
              onCreateEditor={(view) => {
                rightViewRef.current = view
                setEditorsReady((c) => c + 1)
              }}
              theme={isDark ? 'dark' : 'light'}
              extensions={baseExtensions}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: true,
                highlightActiveLineGutter: true,
                searchKeymap: false
              }}
              className="h-full"
              height="100%"
            />
          </div>
        </div>
      </div>

      <DiffStatusBar
        diff={diff}
        onPrev={goToPrevHunk}
        onNext={goToNextHunk}
        onSwap={() => swapDiffSides(diffTab.id)}
        onClose={() => closeDiffTab(diffTab.id)}
      />
    </div>
  )
}

export default DiffView
