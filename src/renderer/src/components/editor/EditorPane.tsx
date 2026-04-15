import { useMemo, useState } from 'react'
import { resolveEditorMode, useWorkspace } from '@/store/workspace'
import { countWords } from '@/lib/text-stats'
import VisualEditor from './VisualEditor'
import RawEditor from './RawEditor'

const EmptyState = (): React.JSX.Element => (
  <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
    <h1 className="text-lg font-medium">smarkup</h1>
    <p className="text-sm">Open a folder and pick a file — or create a new one.</p>
  </div>
)

type EditorPaneProps = {
  tabId: string | null
  paneId: string
}

/**
 * Instead of destroying and recreating editors on tab switch (which loses
 * scroll position), we render ALL visited tabs' editors stacked on top of
 * each other. The active tab is visible; the rest are hidden but keep their
 * DOM, scroll position, cursor, and undo history intact — the Chrome approach.
 */
const EditorPane = ({ tabId, paneId }: EditorPaneProps): React.JSX.Element => {
  const tabs = useWorkspace((s) => s.tabs)
  const editorMode = useWorkspace((s) => s.editorMode)
  const fileEditorModes = useWorkspace((s) => s.fileEditorModes)
  const showWordCount = useWorkspace((s) => s.showWordCount)
  const updateTabContent = useWorkspace((s) => s.updateTabContent)
  const setActivePane = useWorkspace((s) => s.setActivePane)
  const activePaneId = useWorkspace((s) => s.activePaneId)

  // Track which tabs have been visited so we keep their editors alive.
  // Keyed as `${tabId}::${mode}` so flipping a file's own mode swaps in the
  // other editor (the active tab's entry unmounts and the new-mode entry
  // takes its place); other tabs keep their mounted editors intact.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set())

  const currentTab = tabId ? tabs.find((t) => t.id === tabId) : undefined
  const currentMode = resolveEditorMode(currentTab?.path, fileEditorModes, editorMode)
  const currentKey = tabId ? `${tabId}::${currentMode}` : null

  // Derive the set that SHOULD be mounted this render: previous set, plus the
  // current key, minus closed tabs and any stale mode-entries for the current
  // tab (so toggling mode swaps editors cleanly). This is a classic
  // "derive state from props" case — setState during render is the documented
  // pattern (React bails on the current render and uses the new state directly).
  const desiredMounted = useMemo(() => {
    const openIds = new Set(tabs.map((t) => t.id))
    const next = new Set<string>()
    for (const key of mounted) {
      const keyTabId = key.slice(0, key.lastIndexOf('::'))
      if (!openIds.has(keyTabId)) continue
      if (currentKey && keyTabId === tabId && key !== currentKey) continue
      next.add(key)
    }
    if (currentKey) next.add(currentKey)
    return next
  }, [mounted, tabs, currentKey, tabId])

  const mountedChanged =
    desiredMounted.size !== mounted.size || [...desiredMounted].some((k) => !mounted.has(k))
  if (mountedChanged) setMounted(desiredMounted)

  const active = tabs.find((t) => t.id === tabId)
  const activeContent = active?.content ?? ''
  const words = useMemo(() => countWords(activeContent), [activeContent])

  if (!active) return <EmptyState />

  const handleFocus = (): void => {
    if (activePaneId !== paneId) {
      setActivePane(paneId)
    }
  }

  return (
    <div className="relative flex h-full flex-col" onMouseDown={handleFocus}>
      <div className="relative flex-1 overflow-hidden">
        {[...desiredMounted].map((key) => {
          const sepIdx = key.lastIndexOf('::')
          const id = key.slice(0, sepIdx)
          const mode = key.slice(sepIdx + 2) as typeof editorMode
          const tab = tabs.find((t) => t.id === id)
          if (!tab) return null
          const isActive = key === currentKey
          const EditorComponent = mode === 'visual' ? VisualEditor : RawEditor
          return (
            <div
              key={key}
              className="absolute inset-0"
              style={{
                visibility: isActive ? 'visible' : 'hidden',
                zIndex: isActive ? 1 : 0,
                pointerEvents: isActive ? 'auto' : 'none'
              }}
            >
              <EditorComponent
                tabId={id}
                value={tab.content}
                onChange={(content: string): void => updateTabContent(id, content)}
                isActive={isActive}
              />
            </div>
          )
        })}
      </div>
      {showWordCount && words > 0 && (
        <span className="absolute bottom-2 right-3 text-[11px] tabular-nums text-muted-foreground">
          {words.toLocaleString()} words
        </span>
      )}
    </div>
  )
}

export default EditorPane
