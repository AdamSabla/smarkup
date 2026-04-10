import { useMemo } from 'react'
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
import { PanelLeftIcon, PanelLeftOpenIcon, PlusIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace, type OpenFile } from '@/store/workspace'
import { countWords, readingMinutes } from '@/lib/text-stats'

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
  onActivate: () => void
  onClose: () => void
}

const Tab = ({ tab, active, onActivate, onClose }: TabProps): React.JSX.Element => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id
  })

  const dirty = tab.content !== tab.savedContent
  const displayName = tab.name.replace(/\.md$/i, '')

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
      onClick={onActivate}
      className={cn(
        'group flex h-8 min-w-0 max-w-[180px] cursor-pointer items-center gap-1 rounded-t-[5px]',
        'pl-[10px] pr-[5px] select-none',
        'text-[12.5px] font-medium transition-colors duration-200',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-background/60 dark:hover:bg-card/50'
      )}
    >
      <span
        className="flex-1 overflow-hidden whitespace-nowrap"
        style={{
          // Fade the last 24px of the label so long names trail off cleanly
          maskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)'
        }}
      >
        {displayName}
      </span>
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

const TopBar = (): React.JSX.Element => {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    reorderTabs,
    createDraft,
    sidebarVisible,
    toggleSidebar
  } = useWorkspace()

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const stats = useMemo(() => {
    if (!activeTab) return null
    const words = countWords(activeTab.content)
    return { words, minutes: readingMinutes(words) }
  }, [activeTab])

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
        'drag-region flex h-9 w-full shrink-0 items-end gap-1 border-b border-border/50',
        'bg-sidebar/40 backdrop-blur-xl pt-1 pl-1 select-none'
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
        <div className="flex min-w-0 flex-1 items-end gap-[2px] overflow-hidden">
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
                  onActivate={() => setActiveTab(tab.id)}
                  onClose={() => closeTab(tab.id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* Add tab button */}
          <button
            onClick={() => void createDraft()}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className={cn(
              'mb-[2px] ml-1 flex size-6 shrink-0 items-center justify-center rounded-full',
              'text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
            )}
            aria-label="New tab"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
      )}

      {/* Right side — word count / reading time, and room for Win/Linux
         titleBarOverlay controls */}
      <div
        className={cn(
          'mb-[4px] flex shrink-0 items-center gap-2 pr-3 text-[11px] tabular-nums text-muted-foreground',
          !isMac && 'mr-[140px]'
        )}
      >
        {stats && stats.words > 0 && (
          <>
            <span>{stats.words.toLocaleString()} words</span>
            <span className="text-border">·</span>
            <span>{stats.minutes} min</span>
          </>
        )}
      </div>
    </div>
  )
}

export default TopBar
