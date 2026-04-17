import { useMemo, useState } from 'react'
import { FilePlusIcon, FileTextIcon } from 'lucide-react'
import { resolveEditorMode, useWorkspace } from '@/store/workspace'
import { countWords } from '@/lib/text-stats'
import TodoChip from '@/components/TodoChip'
import VisualEditor from './VisualEditor'
import RawEditor from './RawEditor'
import DiffView from './DiffView'
import FindBar from './FindBar'
import OrphanBanner from './OrphanBanner'

const isMac = navigator.userAgent.toLowerCase().includes('mac')
const MOD_KEY = isMac ? '⌘' : 'Ctrl'

/**
 * Landing screen when no tab is open — a primary "New file" CTA followed by
 * the five most recent files. Clicking a recent routes through `openFile`
 * (navigation source, so Recents order isn't touched until an edit).
 */
const EmptyState = (): React.JSX.Element => {
  const recentFiles = useWorkspace((s) => s.recentFiles)
  const createDraft = useWorkspace((s) => s.createDraft)
  const openFile = useWorkspace((s) => s.openFile)
  const visible = recentFiles.slice(0, 5)

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto px-6 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <button
          onClick={() => void createDraft()}
          className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
            <FilePlusIcon className="size-4" />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="text-sm font-medium text-foreground">New file</span>
            <span className="text-xs text-muted-foreground">Start a fresh note</span>
          </span>
          <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground sm:inline-flex">
            {MOD_KEY} N
          </kbd>
        </button>

        {visible.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent
            </div>
            <div className="flex flex-col gap-0.5">
              {visible.map((path) => {
                const base = path.split('/').pop() ?? path
                const name = base.replace(/\.md$/i, '')
                return (
                  <button
                    key={path}
                    onClick={() => void openFile(path)}
                    title={path}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{name}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

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
  const diffTabs = useWorkspace((s) => s.diffTabs)
  const editorMode = useWorkspace((s) => s.editorMode)
  const fileEditorModes = useWorkspace((s) => s.fileEditorModes)
  const showWordCount = useWorkspace((s) => s.showWordCount)
  const updateTabContent = useWorkspace((s) => s.updateTabContent)
  const setActivePane = useWorkspace((s) => s.setActivePane)
  const activePaneId = useWorkspace((s) => s.activePaneId)

  // Check if the active tab is a diff tab
  const isDiffTab = tabId?.startsWith('diff:') ?? false
  const activeDiffTab = isDiffTab ? diffTabs.find((d) => d.id === tabId) : undefined

  // Track which tabs have been visited so we keep their editors alive.
  // Keyed as `${tabId}::${mode}` so flipping a file's own mode swaps in the
  // other editor (the active tab's entry unmounts and the new-mode entry
  // takes its place); other tabs keep their mounted editors intact.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set())

  const currentTab = tabId && !isDiffTab ? tabs.find((t) => t.id === tabId) : undefined
  const currentMode = resolveEditorMode(currentTab?.path, fileEditorModes, editorMode)
  const currentKey = tabId && !isDiffTab ? `${tabId}::${currentMode}` : null

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

  const active = isDiffTab ? undefined : tabs.find((t) => t.id === tabId)
  const activeContent = active?.content ?? ''
  const words = useMemo(() => countWords(activeContent), [activeContent])

  const handleFocus = (): void => {
    if (activePaneId !== paneId) {
      setActivePane(paneId)
    }
  }

  // Diff tab — render DiffView directly (no keep-alive stack)
  if (isDiffTab && activeDiffTab) {
    return (
      <div className="relative flex h-full flex-col" onMouseDown={handleFocus}>
        <DiffView diffTab={activeDiffTab} isActive={activePaneId === paneId} />
      </div>
    )
  }

  if (!active)
    return (
      <div className="h-full" onMouseDown={handleFocus}>
        <EmptyState />
      </div>
    )

  const isPaneActive = activePaneId === paneId

  return (
    <div className="relative flex h-full flex-col" onMouseDown={handleFocus}>
      {tabId && <OrphanBanner tabId={tabId} />}
      <div className="relative flex-1 overflow-hidden">
        {/* The FindBar floats top-right inside the active pane only — in a
         *  split the inactive pane keeps its own editor's match highlights
         *  cleared (the bar's adapter `clear()` runs when the bar unmounts
         *  or the active editor swaps). */}
        {isPaneActive && <FindBar />}
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
      {/* Bottom-right HUD: word count + TODO chip share the same corner so
       *  they never overlap. The chip is interactive (pointer-events on);
       *  the word count is decorative (pointer-events off) so it doesn't
       *  block clicks on the editor underneath. */}
      <div className="pointer-events-none absolute bottom-2 right-3 z-20 flex items-center gap-2">
        {showWordCount && words > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {words.toLocaleString()} words
          </span>
        )}
        <div className="pointer-events-auto">
          <TodoChip tabId={tabId} isActive={activePaneId === paneId} />
        </div>
      </div>
    </div>
  )
}

export default EditorPane
