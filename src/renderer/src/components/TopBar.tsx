import { useEffect, useRef, useState } from 'react'
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PanelLeftIcon, PanelLeftOpenIcon, PlusIcon, XIcon, EyeIcon, CodeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace, type OpenFile } from '@/store/workspace'


const isMac = navigator.userAgent.toLowerCase().includes('mac')

/**
 * Pre-pivot smarkup tab design — a single top bar that IS the title bar.
 * The bar background is the drag region (click empty space between tabs
 * to move the window); tabs and buttons are no-drag so they remain
 * interactive. On macOS the leftmost 78px is reserved for traffic lights.
 */

type TabProps = {
  tab: OpenFile
  active: boolean
  renaming: boolean
  onActivate: () => void
  onClose: () => void
  onCommitRename: (newName: string) => void
  onCancelRename: () => void
}

const Tab = ({
  tab,
  active,
  renaming,
  onActivate,
  onClose,
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={renaming ? undefined : onActivate}
      className={cn(
        'group relative flex h-8 min-w-[100px] max-w-[180px] cursor-pointer items-center gap-1 rounded-t-[6px]',
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
    </div>
  )
}

const EmptyLabel = (): React.JSX.Element => (
  <div className="flex flex-1 items-center justify-center text-[12.5px] font-medium text-muted-foreground select-none">
    smarkup
  </div>
)

const ModeSwitcher = (): React.JSX.Element => {
  const { editorMode, setEditorMode } = useWorkspace()
  return (
    <div
      className="flex items-center gap-0.5"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={() => void setEditorMode('visual')}
        className={cn(
          'flex size-[26px] items-center justify-center rounded-[5px] transition-colors',
          editorMode === 'visual'
            ? 'bg-foreground/10 text-foreground'
            : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
        )}
        aria-label="Visual mode"
      >
        <EyeIcon className="size-3.5" />
      </button>
      <button
        onClick={() => void setEditorMode('raw')}
        className={cn(
          'flex size-[26px] items-center justify-center rounded-[5px] transition-colors',
          editorMode === 'raw'
            ? 'bg-foreground/10 text-foreground'
            : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
        )}
        aria-label="Raw mode"
      >
        <CodeIcon className="size-3.5" />
      </button>
    </div>
  )
}

const TopBar = (): React.JSX.Element => {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    reorderTabs,
    createDraft,
    sidebarVisible,
    toggleSidebar,
    renamingTabId,
    renameFile,
    cancelRenamingTab
  } = useWorkspace()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = (event: DragEndEvent): void => {
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

      {/* Tabs row */}
      {tabs.length === 0 ? (
        <EmptyLabel />
      ) : (
        <div className="flex min-w-0 flex-1 items-end gap-[2px] overflow-hidden px-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
              {tabs.map((tab) => (
                <Tab
                  key={tab.id}
                  tab={tab}
                  active={tab.id === activeTabId}
                  renaming={tab.id === renamingTabId}
                  onActivate={() => setActiveTab(tab.id)}
                  onClose={() => closeTab(tab.id)}
                  onCommitRename={async (newName) => {
                    cancelRenamingTab()
                    await renameFile(tab.path, newName)
                  }}
                  onCancelRename={cancelRenamingTab}
                />
              ))}
            </SortableContext>
          </DndContext>

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
