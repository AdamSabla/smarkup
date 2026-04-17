import { PanelLeftIcon, PanelLeftOpenIcon, EyeIcon, CodeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')

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

const TopBar = (): React.JSX.Element => {
  const sidebarVisible = useWorkspace((s) => s.sidebarVisible)
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)

  return (
    <div
      className={cn(
        'drag-region flex h-9 w-full shrink-0 items-center gap-1',
        'bg-tab-bar pl-1 select-none'
      )}
    >
      {/* macOS traffic light spacer */}
      {isMac && <div className="w-[74px] shrink-0 self-stretch" />}

      {/* Sidebar toggle */}
      <button
        onClick={() => void toggleSidebar()}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={cn(
          'no-drag flex size-7 shrink-0 items-center justify-center rounded-md',
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

      {/* Spacer — keeps drag region active */}
      <div className="flex-1" />

      {/* Right side — mode switcher */}
      <div
        className={cn(
          'flex shrink-0 items-center pr-3',
          !isMac && 'mr-[140px]'
        )}
      >
        <ModeSwitcher />
      </div>
    </div>
  )
}

export default TopBar
