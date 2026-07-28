import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { XIcon } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useWorkspace, type OpenFile } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')

/**
 * Name of the folder a file sits in, or null when there isn't one to show
 * (unsaved drafts, files at a filesystem root). Handles both separators so
 * Windows paths resolve the same way.
 */
const parentFolderName = (path: string): string | null => {
  if (path.startsWith('draft://')) return null
  const segments = path.split(/[/\\]/).filter(Boolean)
  return segments.length >= 2 ? segments[segments.length - 2] : null
}

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
  onCompareWith?: () => void
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
  onCancelRename,
  onCompareWith
}: TabProps): React.JSX.Element => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id
  })

  const showTabParentFolder = useWorkspace((s) => s.showTabParentFolder)

  const dirty = tab.content !== tab.savedContent
  const displayName = tab.name.replace(/\.md$/i, '')
  const folder = showTabParentFolder ? parentFolderName(tab.path) : null
  const fullLabel = folder ? `${folder} / ${displayName}` : displayName

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
      onClick={
        renaming
          ? undefined
          : (e) => {
              if ((isMac ? e.metaKey : e.ctrlKey) && onCompareWith) {
                e.stopPropagation()
                onCompareWith()
              } else {
                onActivate()
              }
            }
      }
      onDoubleClick={renaming ? undefined : onStartRename}
      className={cn(
        'group relative flex h-8 min-w-[60px] max-w-[180px] flex-1 basis-0 cursor-pointer items-center gap-1 rounded-t-[6px]',
        'pl-[10px] pr-[5px] select-none',
        'text-[12.5px] font-medium transition-colors duration-150',
        // Folder-qualified labels need the extra room to stay readable.
        showTabParentFolder && 'max-w-[260px]',
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
              background: 'radial-gradient(circle at 0 0, transparent 7.5px, var(--background) 8px)'
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
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex min-w-0 flex-1 items-baseline overflow-hidden whitespace-nowrap"
              style={{
                maskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)',
                WebkitMaskImage: 'linear-gradient(90deg, black calc(100% - 24px), transparent)'
              }}
            >
              {folder && (
                <>
                  {/* Shrinks (and truncates) before the file name does — the
                      folder is context, the file name is the identity. */}
                  <span className="min-w-0 shrink truncate font-normal text-current/55">
                    {folder}
                  </span>
                  <span className="shrink-0 px-[3px] font-normal text-current/35">/</span>
                </>
              )}
              <span className="shrink-0">{displayName}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{fullLabel}</TooltipContent>
        </Tooltip>
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
        <ContextMenuItem onSelect={() => useWorkspace.getState().revealInSidebar(tab.path)}>
          Reveal in Sidebar
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            useWorkspace.getState().openDiffPicker({ leftPath: tab.path })
          }}
        >
          Compare with...
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default Tab
