import { useEffect, useRef, useState } from 'react'
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
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PanelLeftIcon, PanelLeftOpenIcon, PlusIcon, XIcon, EyeIcon, CodeIcon } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { useWorkspace, type OpenFile } from '@/store/workspace'


const isMac = navigator.userAgent.toLowerCase().includes('mac')

type TabProps = {
  tab: OpenFile
  active: boolean
  renaming: boolean
  showRightSeparator: boolean
  onActivate: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  onOpenToSide: () => void
  onOpenInNewWindow: () => void
  onStartRename: () => void
  onCommitRename: (newName: string) => void
  onCancelRename: () => void
}

const Tab = ({
  tab,
  active,
  renaming,
  showRightSeparator,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  onOpenToSide,
  onOpenInNewWindow,
  onStartRename,
  onCommitRename,
  onCancelRename
}: TabProps): React.JSX.Element => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id
  })

  const dirty = tab.content !== tab.savedContent
  const displayName = tab.name.replace(/\.md$/i, '')

  const [renameValue, setRenameValue] = useState(displayName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) {
      requestAnimationFrame(() => {
        setRenameValue(displayName)
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [renaming, displayName])

  const commitRename = (): void => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === displayName) {
      onCancelRename()
      return
    }
    onCommitRename(trimmed)
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: active ? 2 : isDragging ? 10 : 1,
    opacity: isDragging ? 0.92 : 1,
    WebkitAppRegion: 'no-drag'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any

  const tabContent = (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={renaming ? undefined : onActivate}
      className={cn(
        'group relative flex h-8 min-w-[60px] max-w-[180px] flex-1 basis-0 cursor-pointer items-center gap-1 rounded-t-[6px]',
        'pl-[10px] pr-[5px] select-none',
        'text-[12.5px] font-medium transition-colors duration-150',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.04]'
      )}
    >
      {/* Chrome-style curved edge connectors for active tab */}
      {active && (
        <>
          <div
            className="pointer-events-none absolute -left-2 bottom-0 size-2"
            style={{
              background:
                'radial-gradient(circle at 0 0, transparent 7.5px, var(--background) 8px)'
            }}
          />
          <div
            className="pointer-events-none absolute -right-2 bottom-0 size-2"
            style={{
              background:
                'radial-gradient(circle at 100% 0, transparent 7.5px, var(--background) 8px)'
            }}
          />
        </>
      )}
      {renaming ? (
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitRename()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancelRename()
            }
            e.stopPropagation()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-transparent text-[12.5px] font-medium outline-none selection:bg-primary/30"
        />
      ) : (
        <span
          className="flex-1 overflow-hidden whitespace-nowrap"
          style={{
            maskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)',
            WebkitMaskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)'
          }}
        >
          {displayName}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full',
          'text-muted-foreground/70 hover:bg-muted hover:text-foreground',
          'transition-colors',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
        aria-label="Close tab"
      >
        {dirty ? (
          <span className="size-[5px] rounded-full bg-current" />
        ) : (
          <XIcon className="size-3" />
        )}
      </button>
      {showRightSeparator && (
        <div
          className="pointer-events-none absolute right-[-2px] top-1/2 h-4 w-px -translate-y-1/2 bg-foreground/15"
          aria-hidden
        />
      )}
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tabContent}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpenToSide}>Open to the Side</ContextMenuItem>
        <ContextMenuItem onSelect={onOpenInNewWindow}>Open in New Window</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onClose}>Close</ContextMenuItem>
        <ContextMenuItem onSelect={onCloseOthers}>Close Others</ContextMenuItem>
        <ContextMenuItem onSelect={onCloseAll}>Close All</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onStartRename}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={() => void window.api.revealInFolder(tab.path)}>
          Reveal in {isMac ? 'Finder' : 'Explorer'}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => {
          useWorkspace.getState().openDiffPicker({ leftPath: tab.path })
        }}>
          Compare with...
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

const ModeSwitcher = (): React.JSX.Element => {
  const { editorMode, fileEditorModes, activeTabId, tabs, setEditorMode } = useWorkspace()
  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : undefined
  const effectiveMode =
    activeTab && fileEditorModes[activeTab.path] ? fileEditorModes[activeTab.path] : editorMode
  const isVisual = effectiveMode === 'visual'
  return (
    <button
      onClick={() => void setEditorMode(isVisual ? 'raw' : 'visual')}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className="group flex items-center gap-0.5 rounded-[6px] p-0.5 hover:bg-foreground/[0.04] transition-colors"
      aria-label={`Switch to ${isVisual ? 'raw' : 'visual'} mode`}
    >
      <span
        className={cn(
          'flex size-[26px] items-center justify-center rounded-[5px] transition-colors',
          isVisual
            ? 'bg-foreground/10 text-foreground'
            : 'text-muted-foreground group-hover:text-foreground'
        )}
      >
        <EyeIcon className="size-3.5" />
      </span>
      <span
        className={cn(
          'flex size-[26px] items-center justify-center rounded-[5px] transition-colors',
          !isVisual
            ? 'bg-foreground/10 text-foreground'
            : 'text-muted-foreground group-hover:text-foreground'
        )}
      >
        <CodeIcon className="size-3.5" />
      </span>
    </button>
  )
}

const DiffTabItem = ({
  active,
  onActivate,
  onClose,
}: {
  active: boolean
  onActivate: () => void
  onClose: () => void
}): React.JSX.Element => {
  return (
    <div
      onClick={onActivate}
      className={cn(
        'group relative flex h-8 min-w-[60px] max-w-[220px] flex-1 basis-0 cursor-pointer items-center gap-1 rounded-t-[6px]',
        'pl-[10px] pr-[5px] select-none',
        'text-[12.5px] font-medium transition-colors duration-150',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.04]',
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {active && (
        <>
          <div
            className="pointer-events-none absolute -left-2 bottom-0 size-2"
            style={{ background: 'radial-gradient(circle at 0 0, transparent 7.5px, var(--background) 8px)' }}
          />
          <div
            className="pointer-events-none absolute -right-2 bottom-0 size-2"
            style={{ background: 'radial-gradient(circle at 100% 0, transparent 7.5px, var(--background) 8px)' }}
          />
        </>
      )}
      <span
        className="flex-1 overflow-hidden whitespace-nowrap"
        style={{
          maskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)',
        }}
      >
        Diff
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full',
          'text-muted-foreground/70 hover:bg-muted hover:text-foreground',
          'transition-colors',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        aria-label="Close diff tab"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

const TopBar = (): React.JSX.Element => {
  const {
    tabs,
    diffTabs,
    activeTabId,
    setActiveTab,
    closeTab,
    closeDiffTab,
    requestCloseTab,
    requestCloseOtherTabs,
    requestCloseAllTabs,
    reorderTabs,
    createDraft,
    sidebarVisible,
    toggleSidebar,
    renamingTabId,
    renameFile,
    cancelRenamingTab,
    startRenamingTab,
    splitPane,
    activePaneId
  } = useWorkspace()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // --- Drag-out detection state ---
  const tabBarRef = useRef<HTMLDivElement>(null)
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null)
  const draggingTabIdRef = useRef<string | null>(null)
  const didDetachRef = useRef(false)

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
    const fromIndex = tabs.findIndex((t) => t.id === active.id)
    const toIndex = tabs.findIndex((t) => t.id === over.id)
    if (fromIndex === -1 || toIndex === -1) return
    reorderTabs(fromIndex, toIndex)
  }

  return (
    <div
      className={cn(
        'drag-region flex h-9 w-full shrink-0 items-end gap-1',
        'bg-tab-bar pt-1 pl-1 select-none'
      )}
    >
      {/* macOS traffic light spacer */}
      {isMac && <div className="w-[74px] shrink-0 self-stretch" />}

      {/* Sidebar toggle — no-drag so it stays clickable */}
      <button
        onClick={() => void toggleSidebar()}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={cn(
          'no-drag mb-[2px] flex size-7 shrink-0 items-center justify-center rounded-md',
          'text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
        )}
        aria-label="Toggle sidebar"
      >
        {sidebarVisible ? (
          <PanelLeftIcon className="size-4" />
        ) : (
          <PanelLeftOpenIcon className="size-4" />
        )}
      </button>

      {/* Tabs row — an empty flex-1 placeholder keeps the drag region
       *  intact when no tabs are open (the empty-state CTA lives in the
       *  editor area below instead of showing a "smarkup" label here). */}
      {tabs.length === 0 ? (
        <div className="flex-1" />
      ) : (
        <div ref={tabBarRef} className="flex min-w-0 flex-1 items-end gap-[2px] overflow-hidden px-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
              {tabs.map((tab, index) => {
                const nextTab = tabs[index + 1]
                const isActive = tab.id === activeTabId
                const nextIsActive = nextTab?.id === activeTabId
                return (
                <Tab
                  key={tab.id}
                  tab={tab}
                  active={isActive}
                  renaming={tab.id === renamingTabId}
                  showRightSeparator={!isActive && !!nextTab && !nextIsActive}
                  onActivate={() => setActiveTab(tab.id)}
                  onClose={() => requestCloseTab(tab.id)}
                  onCloseOthers={() => requestCloseOtherTabs(tab.id)}
                  onCloseAll={requestCloseAllTabs}
                  onOpenToSide={() => splitPane(activePaneId, 'horizontal', tab.id)}
                  onOpenInNewWindow={() => {
                    void window.api.openTabInNewWindow(
                      { path: tab.path, content: tab.content, savedContent: tab.savedContent },
                      { x: window.screenX + 50, y: window.screenY + 50 }
                    )
                    closeTab(tab.id)
                  }}
                  onStartRename={() => {
                    setActiveTab(tab.id)
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

          {/* Diff tabs (non-sortable, appear after regular tabs) */}
          {diffTabs.map((dt) => (
            <DiffTabItem
              key={dt.id}
              active={dt.id === activeTabId}
              onActivate={() => setActiveTab(dt.id)}
              onClose={() => closeDiffTab(dt.id)}
            />
          ))}

          {/* Add tab button */}
          <button
            onClick={() => void createDraft()}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn(
              'ml-1 flex size-6 shrink-0 self-center items-center justify-center rounded-full',
              'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground transition-colors'
            )}
            aria-label="New tab"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
      )}

      {/* Right side — mode switcher, and room for Win/Linux titleBarOverlay controls */}
      <div
        className={cn(
          'flex shrink-0 items-center self-center pr-3',
          !isMac && 'mr-[140px]'
        )}
      >
        <ModeSwitcher />
      </div>
    </div>
  )
}

export default TopBar
