import { useRef } from 'react'
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { PlusIcon, PanelLeftOpenIcon, EyeIcon, CodeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveEditorMode, useWorkspace, type LeafPane } from '@/store/workspace'
import Tab from '@/components/Tab'
import DiffTabItem from '@/components/DiffTabItem'

const isMac = navigator.userAgent.toLowerCase().includes('mac')

/** Find a leaf pane by id in the pane tree */
const findLeaf = (node: import('@/store/workspace').PaneNode, id: string): LeafPane | null => {
  if (node.type === 'leaf') return node.id === id ? node : null
  return findLeaf(node.children[0], id) ?? findLeaf(node.children[1], id)
}

type PaneTabBarProps = {
  paneId: string
  isFirst?: boolean
  isLast?: boolean
}

const PaneTabBar = ({ paneId, isFirst = false, isLast = false }: PaneTabBarProps): React.JSX.Element => {
  const paneRoot = useWorkspace((s) => s.paneRoot)
  const tabs = useWorkspace((s) => s.tabs)
  const diffTabs = useWorkspace((s) => s.diffTabs)
  const activePaneId = useWorkspace((s) => s.activePaneId)
  const setActiveTab = useWorkspace((s) => s.setActiveTab)
  const setActivePane = useWorkspace((s) => s.setActivePane)
  const closeTab = useWorkspace((s) => s.closeTab)
  const closeDiffTab = useWorkspace((s) => s.closeDiffTab)
  const requestCloseTab = useWorkspace((s) => s.requestCloseTab)
  const requestCloseOtherTabs = useWorkspace((s) => s.requestCloseOtherTabs)
  const requestCloseAllTabs = useWorkspace((s) => s.requestCloseAllTabs)
  const reorderTabs = useWorkspace((s) => s.reorderTabs)
  const createDraft = useWorkspace((s) => s.createDraft)
  const renamingTabId = useWorkspace((s) => s.renamingTabId)
  const renameFile = useWorkspace((s) => s.renameFile)
  const cancelRenamingTab = useWorkspace((s) => s.cancelRenamingTab)
  const startRenamingTab = useWorkspace((s) => s.startRenamingTab)
  const splitPane = useWorkspace((s) => s.splitPane)
  const sidebarVisible = useWorkspace((s) => s.sidebarVisible)
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)
  const editorMode = useWorkspace((s) => s.editorMode)
  const fileEditorModes = useWorkspace((s) => s.fileEditorModes)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const setEditorMode = useWorkspace((s) => s.setEditorMode)

  const leaf = findLeaf(paneRoot, paneId)
  const paneTabIds = leaf?.tabIds ?? []
  const paneActiveTabId = leaf?.activeTabId ?? null

  // Resolve the actual OpenFile objects for this pane's tabs
  const paneTabs = paneTabIds
    .filter((id) => !id.startsWith('diff:'))
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is import('@/store/workspace').OpenFile => t != null)

  // Diff tabs in this pane
  const paneDiffTabs = paneTabIds
    .filter((id) => id.startsWith('diff:'))
    .map((id) => diffTabs.find((d) => d.id === id))
    .filter((d): d is import('@/store/workspace').DiffTab => d != null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // --- Drag-out detection state ---
  const tabBarRef = useRef<HTMLDivElement>(null)
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null)
  const draggingTabIdRef = useRef<string | null>(null)
  const didDetachRef = useRef(false)

  // Show sidebar toggle in the first pane when sidebar is hidden
  const showSidebarToggle = isFirst && !sidebarVisible
  // Show traffic light spacer in the first pane when sidebar is hidden on macOS
  const showTrafficSpacer = isFirst && !sidebarVisible && isMac

  // Mode switcher state
  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : undefined
  const effectiveMode = resolveEditorMode(activeTab?.path, fileEditorModes, editorMode)
  const isVisual = effectiveMode === 'visual'

  const handleDragStart = (event: DragStartEvent): void => {
    draggingTabIdRef.current = event.active.id as string
    didDetachRef.current = false
    const activatorEvent = event.activatorEvent as PointerEvent
    dragStartPosRef.current = { x: activatorEvent.clientX, y: activatorEvent.clientY }
  }

  const handleDragMove = (event: DragMoveEvent): void => {
    if (didDetachRef.current) return
    const rect = tabBarRef.current?.getBoundingClientRect()
    if (!rect || !dragStartPosRef.current) return

    const currentY = dragStartPosRef.current.y + event.delta.y

    // If pointer is 50px+ below the tab bar, trigger detach
    if (currentY > rect.bottom + 50 || currentY < rect.top - 50) {
      didDetachRef.current = true
      const tabId = draggingTabIdRef.current
      const tab = tabs.find((t) => t.id === tabId)
      if (tab) {
        const screenX = dragStartPosRef.current.x + event.delta.x
        const screenY = dragStartPosRef.current.y + event.delta.y
        void window.api.openTabInNewWindow(
          { path: tab.path, content: tab.content, savedContent: tab.savedContent },
          { x: screenX + window.screenX - 300, y: screenY + window.screenY - 20 }
        )
        closeTab(tab.id)
      }
    }
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    dragStartPosRef.current = null
    draggingTabIdRef.current = null
    if (didDetachRef.current) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = paneTabs.findIndex((t) => t.id === active.id)
    const toIndex = paneTabs.findIndex((t) => t.id === over.id)
    if (fromIndex === -1 || toIndex === -1) return
    const fromPaneIdx = paneTabIds.indexOf(active.id as string)
    const toPaneIdx = paneTabIds.indexOf(over.id as string)
    if (fromPaneIdx === -1 || toPaneIdx === -1) return
    if (activePaneId !== paneId) setActivePane(paneId)
    reorderTabs(fromPaneIdx, toPaneIdx)
  }

  const handleActivate = (tabId: string): void => {
    if (activePaneId !== paneId) setActivePane(paneId)
    setActiveTab(tabId)
  }

  return (
    <div
      ref={tabBarRef}
      className={cn(
        'drag-region flex h-8 w-full shrink-0 items-end gap-[2px] overflow-hidden',
        'bg-tab-bar select-none',
        showTrafficSpacer ? 'pl-[74px]' : 'pl-1'
      )}
    >
      {/* Sidebar toggle (when sidebar hidden, first pane only) */}
      {showSidebarToggle && (
        <button
          onClick={() => void toggleSidebar()}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center self-center rounded-md',
            'text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
          )}
          aria-label="Toggle sidebar"
        >
          <PanelLeftOpenIcon className="size-3.5" />
        </button>
      )}

      {paneTabs.length === 0 && paneDiffTabs.length === 0 ? (
        <div className="flex flex-1 items-center">
          <button
            onClick={() => {
              if (activePaneId !== paneId) setActivePane(paneId)
              void createDraft()
            }}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn(
              'ml-0.5 flex size-5 shrink-0 items-center justify-center rounded-full',
              'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors'
            )}
            aria-label="New tab"
          >
            <PlusIcon className="size-3" />
          </button>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-end gap-[2px] overflow-hidden">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={paneTabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
              {paneTabs.map((tab, index) => {
                const nextTab = paneTabs[index + 1]
                const isActive = tab.id === paneActiveTabId
                const nextIsActive = nextTab?.id === paneActiveTabId
                return (
                  <Tab
                    key={tab.id}
                    tab={tab}
                    active={isActive}
                    renaming={tab.id === renamingTabId}
                    showRightSeparator={!isActive && !!nextTab && !nextIsActive}
                    onActivate={() => handleActivate(tab.id)}
                    onClose={() => requestCloseTab(tab.id)}
                    onCloseOthers={() => requestCloseOtherTabs(tab.id)}
                    onCloseAll={requestCloseAllTabs}
                    onOpenToSide={() => splitPane(paneId, 'horizontal', tab.id)}
                    onOpenInNewWindow={() => {
                      void window.api.openTabInNewWindow(
                        { path: tab.path, content: tab.content, savedContent: tab.savedContent },
                        { x: window.screenX + 50, y: window.screenY + 50 }
                      )
                      closeTab(tab.id)
                    }}
                    onStartRename={() => {
                      handleActivate(tab.id)
                      startRenamingTab()
                    }}
                    onCommitRename={async (newName) => {
                      cancelRenamingTab()
                      await renameFile(tab.path, newName)
                    }}
                    onCancelRename={cancelRenamingTab}
                  />
                )
              })}
            </SortableContext>
          </DndContext>

          {/* Diff tabs (non-sortable) */}
          {paneDiffTabs.map((dt) => (
            <DiffTabItem
              key={dt.id}
              active={dt.id === paneActiveTabId}
              onActivate={() => handleActivate(dt.id)}
              onClose={() => closeDiffTab(dt.id)}
            />
          ))}

          {/* Add tab button — right after last tab */}
          <div className="relative flex shrink-0 items-center self-stretch">
            {/* Separator before plus icon when last tab is inactive */}
            {paneActiveTabId !== paneTabs[paneTabs.length - 1]?.id &&
              paneActiveTabId !== paneDiffTabs[paneDiffTabs.length - 1]?.id && (
              <div
                className="pointer-events-none absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-foreground/15"
                aria-hidden
              />
            )}
            <button
              onClick={() => {
                if (activePaneId !== paneId) setActivePane(paneId)
                void createDraft()
              }}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              className={cn(
                'ml-1 flex size-5 shrink-0 items-center justify-center rounded-full',
                'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors'
              )}
              aria-label="New tab"
            >
              <PlusIcon className="size-3" />
            </button>
          </div>
        </div>
      )}

      {/* Mode switcher — only in the last (rightmost) pane */}
      {isLast && (
        <button
          onClick={() => void setEditorMode(isVisual ? 'raw' : 'visual')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={cn(
            'group ml-auto flex items-center gap-0.5 self-center rounded-[6px] p-0.5',
            'hover:bg-foreground/[0.04] transition-colors',
            isMac ? 'mr-2' : 'mr-[140px]'
          )}
          aria-label={`Switch to ${isVisual ? 'raw' : 'visual'} mode`}
        >
          <span
            className={cn(
              'flex size-[22px] items-center justify-center rounded-[4px] transition-colors',
              isVisual
                ? 'bg-foreground/10 text-foreground'
                : 'text-muted-foreground group-hover:text-foreground'
            )}
          >
            <EyeIcon className="size-3" />
          </span>
          <span
            className={cn(
              'flex size-[22px] items-center justify-center rounded-[4px] transition-colors',
              !isVisual
                ? 'bg-foreground/10 text-foreground'
                : 'text-muted-foreground group-hover:text-foreground'
            )}
          >
            <CodeIcon className="size-3" />
          </span>
        </button>
      )}
    </div>
  )
}

export default PaneTabBar
