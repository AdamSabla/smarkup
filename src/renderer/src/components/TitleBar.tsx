import { useMemo } from 'react'
import { PanelLeftIcon, PanelLeftOpenIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'
import { countWords, readingMinutes } from '@/lib/text-stats'

const isMac = navigator.userAgent.toLowerCase().includes('mac')

const TitleBar = (): React.JSX.Element => {
  const { sidebarVisible, toggleSidebar, tabs, activeTabId } = useWorkspace()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const title = activeTab ? activeTab.name.replace(/\.md$/i, '') : 'smarkup'

  const stats = useMemo(() => {
    if (!activeTab) return null
    const words = countWords(activeTab.content)
    return { words, minutes: readingMinutes(words) }
  }, [activeTab])

  return (
    <div
      className={cn(
        'drag-region flex h-9 w-full shrink-0 items-center border-b border-border/50',
        'bg-sidebar/40 backdrop-blur-xl select-none'
      )}
    >
      {/* Space for traffic lights on macOS */}
      {isMac && <div className="w-[78px]" />}

      <div className="no-drag flex items-center gap-1 px-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => void toggleSidebar()}
          aria-label="Toggle sidebar"
        >
          {sidebarVisible ? (
            <PanelLeftIcon className="size-4" />
          ) : (
            <PanelLeftOpenIcon className="size-4" />
          )}
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center text-xs font-medium text-muted-foreground">
        {title}
      </div>

      <div
        className={cn(
          'flex items-center gap-2 pr-3 text-[11px] tabular-nums text-muted-foreground',
          !isMac && 'mr-[140px]'
        )}
      >
        {stats && stats.words > 0 && (
          <>
            <span>{stats.words.toLocaleString()} words</span>
            <span className="text-border">·</span>
            <span>{stats.minutes} min read</span>
          </>
        )}
      </div>
    </div>
  )
}

export default TitleBar
