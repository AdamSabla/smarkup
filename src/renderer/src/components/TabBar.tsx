import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

const TabBar = (): React.JSX.Element | null => {
  const { tabs, activeTabId, setActiveTab, closeTab } = useWorkspace()

  if (tabs.length === 0) return null

  return (
    <div className="flex h-9 shrink-0 items-end gap-1 border-b border-border/50 bg-background/60 px-2 pt-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const dirty = tab.content !== tab.savedContent
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'group flex h-8 min-w-0 max-w-[180px] cursor-pointer items-center gap-2 rounded-t-md border border-b-0 px-2.5',
              'text-xs font-medium transition-colors',
              active
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/40'
            )}
          >
            <span className="flex-1 truncate">{tab.name.replace(/\.md$/, '')}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
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
      })}
    </div>
  )
}

export default TabBar
