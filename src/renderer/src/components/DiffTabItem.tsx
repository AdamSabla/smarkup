import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type DiffTabItemProps = {
  active: boolean
  onActivate: () => void
  onClose: () => void
}

const DiffTabItem = ({ active, onActivate, onClose }: DiffTabItemProps): React.JSX.Element => {
  return (
    <div
      onClick={onActivate}
      className={cn(
        'group relative flex h-8 min-w-[60px] max-w-[220px] flex-1 basis-0 cursor-pointer items-center gap-1 rounded-t-[6px]',
        'pl-[10px] pr-[5px] select-none',
        'text-[12.5px] font-medium transition-colors duration-150',
        active
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-foreground/[0.04]'
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
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
      <span
        className="flex-1 overflow-hidden whitespace-nowrap"
        style={{
          maskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)'
        }}
      >
        Diff
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
        aria-label="Close diff tab"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

export default DiffTabItem
