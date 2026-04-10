import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace, type OpenFile } from '@/store/workspace'

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
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onActivate}
      className={cn(
        'group flex h-8 min-w-0 max-w-[180px] cursor-pointer items-center gap-2 rounded-t-md border border-b-0 px-2.5',
        'text-xs font-medium transition-colors select-none',
        active
          ? 'border-border bg-background text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted/40'
      )}
    >
      <span className="flex-1 truncate">{tab.name.replace(/\.md$/i, '')}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm',
          'text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent',
          active && 'opacity-60'
        )}
        aria-label="Close tab"
      >
        {dirty ? (
          <span className="size-1.5 rounded-full bg-current" />
        ) : (
          <XIcon className="size-3" />
        )}
      </button>
    </div>
  )
}

const TabBar = (): React.JSX.Element | null => {
  const { tabs, activeTabId, setActiveTab, closeTab, reorderTabs } = useWorkspace()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small activation distance so clicks still trigger `onClick`
      activationConstraint: { distance: 4 }
    })
  )

  if (tabs.length === 0) return null

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIndex = tabs.findIndex((t) => t.id === active.id)
    const toIndex = tabs.findIndex((t) => t.id === over.id)
    if (fromIndex === -1 || toIndex === -1) return
    reorderTabs(fromIndex, toIndex)
  }

  return (
    <div className="flex h-9 shrink-0 items-end gap-1 border-b border-border/50 bg-background/60 px-2 pt-1">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
    </div>
  )
}

export default TabBar
