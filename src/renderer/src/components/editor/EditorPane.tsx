import { useMemo, useRef } from 'react'
import { useWorkspace } from '@/store/workspace'
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
  const showWordCount = useWorkspace((s) => s.showWordCount)
  const updateTabContent = useWorkspace((s) => s.updateTabContent)
  const setActivePane = useWorkspace((s) => s.setActivePane)
  const activePaneId = useWorkspace((s) => s.activePaneId)

  // Track which tabs have been visited so we keep their editors alive.
  const mountedRef = useRef(new Set<string>())
  const lastModeRef = useRef(editorMode)

  // Clear all mounted editors when editor mode switches (visual ↔ raw)
  if (lastModeRef.current !== editorMode) {
    lastModeRef.current = editorMode
    mountedRef.current = new Set<string>()
  }

  // Add current tab to mounted set (synchronous — no extra render)
  if (tabId && !mountedRef.current.has(tabId)) {
    mountedRef.current = new Set(mountedRef.current)
    mountedRef.current.add(tabId)
  }

  // Prune closed tabs
  const openIds = new Set(tabs.map((t) => t.id))
  for (const id of mountedRef.current) {
    if (!openIds.has(id)) {
      mountedRef.current = new Set(mountedRef.current)
      mountedRef.current.delete(id)
    }
  }

  const active = tabs.find((t) => t.id === tabId)
  const activeContent = active?.content ?? ''
  const words = useMemo(() => countWords(activeContent), [activeContent])

  if (!active) return <EmptyState />

  const handleFocus = (): void => {
    if (activePaneId !== paneId) {
      setActivePane(paneId)
    }
  }

  const EditorComponent = editorMode === 'visual' ? VisualEditor : RawEditor

  return (
    <div className="relative flex h-full flex-col" onMouseDown={handleFocus}>
      <div className="relative flex-1 overflow-hidden">
        {[...mountedRef.current].map((id) => {
          const tab = tabs.find((t) => t.id === id)
          if (!tab) return null
          const isActive = id === tabId
          return (
            <div
              key={id}
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
