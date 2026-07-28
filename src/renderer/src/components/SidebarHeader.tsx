import { PanelLeftIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')

const SidebarHeader = (): React.JSX.Element => {
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)

  return (
    <div
      className={cn(
        'drag-region relative flex h-8 shrink-0 items-center bg-tab-bar pl-1 select-none'
      )}
    >
      {/* Contrast behind the macOS window buttons while the window is inactive */}
      {isMac && <div className="traffic-light-shade" aria-hidden />}
      {isMac && <div className="w-[74px] shrink-0 self-stretch" />}
      <button
        onClick={() => void toggleSidebar()}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={cn(
          'relative flex size-7 shrink-0 items-center justify-center rounded-md',
          'text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
        )}
        aria-label="Toggle sidebar"
      >
        <PanelLeftIcon className="size-4" />
      </button>
    </div>
  )
}

export default SidebarHeader
