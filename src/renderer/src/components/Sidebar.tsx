import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext as DndKitContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS as DndCSS } from '@dnd-kit/utilities'
import {
  FilePlusIcon,
  FolderPlusIcon,
  FileTextIcon,
  GripVerticalIcon,
  PencilIcon,
  TrashIcon,
  MoreHorizontalIcon,
  SettingsIcon,
  FolderMinusIcon,
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  PlusIcon,
  XIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useWorkspace, type SidebarSection, type FolderNode } from '@/store/workspace'
import type { FileEntry } from '../../../preload'

const INITIAL_VISIBLE = 10

/** Sentinel id for the top-of-sidebar Recents section. Not a real path —
 *  used as a section key in `collapsedSectionIds` so its expanded/collapsed
 *  state persists alongside regular sections. */
const RECENTS_ID = '__recents__'

// --- Drag & drop ------------------------------------------------------------
// We use a custom MIME type so outside drags (text, files from Finder) can't
// accidentally trigger a move. The payload is a JSON `{kind, path}` read on
// drop; during dragenter/dragover the browser only exposes `types`, which is
// enough to tell "this is our sidebar drag" without leaking the payload.
const DND_MIME = 'application/x-smarkup-sidebar-item'
type DragPayload = { kind: 'file' | 'folder'; path: string }

type DndContext = {
  /** Path of the drop target currently under the cursor (for highlighting). */
  dragOverPath: string | null
  /** Path of the item being dragged — used to suppress self-drop highlight. */
  draggingPath: string | null
  onItemDragStart: (e: React.DragEvent, payload: DragPayload) => void
  onItemDragEnd: () => void
  /** Call on BOTH dragenter and dragover. Setting on both keeps highlight
   *  tracking robust (enter can be missed in edge cases) and the continuous
   *  dragover stream lets the innermost target always win via stopPropagation. */
  onTargetDragOver: (e: React.DragEvent, targetPath: string, destDir: string) => void
  onTargetDrop: (e: React.DragEvent, destDir: string) => void
  /** Scroll a sidebar row into view after the tree has been re-sorted.
   *  Piggybacks on this context because both FileRow and SubfolderView
   *  already consume it; avoids threading a helper through every prop level. */
  scrollPathIntoView: (path: string) => void
}
const SidebarDndContext = createContext<DndContext | null>(null)
const useSidebarDnd = (): DndContext => {
  const ctx = useContext(SidebarDndContext)
  if (!ctx) throw new Error('SidebarDndContext missing')
  return ctx
}

const isMac = navigator.platform.startsWith('Mac')

const revealLabel = navigator.platform.startsWith('Win')
  ? 'Show in Explorer'
  : isMac
    ? 'Reveal in Finder'
    : 'Show in file manager'

const TruncatedName = ({
  children,
  className
}: {
  children: string
  className?: string
}): React.JSX.Element => {
  const ref = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  const check = useCallback(() => {
    const el = ref.current
    if (el) setOverflowing(el.scrollWidth > el.clientWidth)
  }, [])

  const label = (
    <span ref={ref} onMouseEnter={check} className={cn('min-w-0 flex-1 truncate', className)}>
      {children}
    </span>
  )

  if (!overflowing) return label

  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent side="right">{children}</TooltipContent>
    </Tooltip>
  )
}

type FlatItem = {
  path: string
  type: 'section' | 'folder' | 'file'
  parentPath: string | null
}

function flattenVisibleTree(
  sections: SidebarSection[],
  expandedPaths: Set<string>,
  showAllSections: Set<string>
): FlatItem[] {
  const items: FlatItem[] = []

  for (const section of sections) {
    items.push({ path: section.id, type: 'section', parentPath: null })
    if (!expandedPaths.has(section.id)) continue

    const walkFolder = (folder: FolderNode, parentPath: string): void => {
      items.push({ path: folder.path, type: 'folder', parentPath })
      if (!expandedPaths.has(folder.path)) return
      for (const sub of folder.subfolders) walkFolder(sub, folder.path)
      for (const file of folder.files) {
        items.push({ path: file.path, type: 'file', parentPath: folder.path })
      }
    }

    const allFiles = section.files
    const visible = showAllSections.has(section.id) ? allFiles : allFiles.slice(0, INITIAL_VISIBLE)
    for (const file of visible) {
      items.push({ path: file.path, type: 'file', parentPath: section.id })
    }

    for (const sub of section.subfolders) walkFolder(sub, section.id)
  }

  return items
}

type RenameInputProps = {
  initialValue: string
  onCommit: (value: string) => void
  onCancel: () => void
}

/**
 * Isolated rename input — mounted fresh each time renaming starts so
 * `useState(initialValue)` picks up the current value without needing
 * a state-sync effect.
 */
const RenameInput = ({ initialValue, onCommit, onCancel }: RenameInputProps): React.JSX.Element => {
  const [value, setValue] = useState(initialValue)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (): void => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === initialValue) {
      onCancel()
      return
    }
    onCommit(trimmed)
  }

  return (
    <div
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1',
        'bg-sidebar-accent text-sidebar-accent-foreground'
      )}
    >
      <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
          e.stopPropagation()
        }}
        className="flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  )
}

type FolderRenameInputProps = {
  initialValue: string
  depth: number
  onCommit: (value: string) => void
  onCancel: () => void
}

const FolderRenameInput = ({
  initialValue,
  depth,
  onCommit,
  onCancel
}: FolderRenameInputProps): React.JSX.Element => {
  const [value, setValue] = useState(initialValue)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const commit = (): void => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === initialValue) {
      onCancel()
      return
    }
    onCommit(trimmed)
  }

  return (
    <div
      style={{ paddingLeft: 8 + depth * 12 }}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md pr-2 py-1',
        'bg-sidebar-accent text-sidebar-accent-foreground'
      )}
    >
      <ChevronRightIcon className="size-3 shrink-0" />
      <FolderIcon className="size-3.5 shrink-0" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
          e.stopPropagation()
        }}
        className="flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  )
}

type FileRowProps = {
  file: FileEntry
  active: boolean
  focused: boolean
  renaming: boolean
  onActivate: () => void
  onFocusItem: () => void
  onStartRename: () => void
  onCommitRename: (newName: string) => void
  onCancelRename: () => void
  onDelete: () => void
}

const FileRow = ({
  file,
  active,
  focused,
  renaming,
  onActivate,
  onFocusItem,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete
}: FileRowProps): React.JSX.Element => {
  const displayName = file.name.replace(/\.md$/i, '')
  const [menuOpen, setMenuOpen] = useState(false)
  const dnd = useSidebarDnd()

  if (renaming) {
    return (
      <RenameInput initialValue={displayName} onCommit={onCommitRename} onCancel={onCancelRename} />
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          data-sidebar-path={file.path}
          draggable
          onDragStart={(e) => dnd.onItemDragStart(e, { kind: 'file', path: file.path })}
          onDragEnd={dnd.onItemDragEnd}
          onClick={() => onFocusItem()}
          onDoubleClick={onActivate}
          className={cn(
            'group/row relative flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            (focused || active) && 'bg-sidebar-accent text-sidebar-accent-foreground',
            active && 'font-medium'
          )}
        >
          <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <TruncatedName>{displayName}</TruncatedName>

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuOpen(true)
                }}
                className={cn(
                  'absolute right-1 inline-flex items-center justify-center rounded-sm size-5',
                  'opacity-0 group-hover/row:opacity-100 bg-sidebar-accent',
                  menuOpen && 'opacity-100'
                )}
              >
                <MoreHorizontalIcon className="size-3.5 text-muted-foreground" />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuItem onSelect={onStartRename}>
                <PencilIcon className="size-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void window.api.revealInFolder(file.path)}>
                <FolderOpenIcon className="size-3.5" />
                {revealLabel}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <TrashIcon className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onStartRename}>
          <PencilIcon className="size-3.5" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void window.api.revealInFolder(file.path)}>
          <FolderOpenIcon className="size-3.5" />
          {revealLabel}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <TrashIcon className="size-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

type FileListProps = {
  files: FileEntry[]
  renamingPath: string | null
  focusedItem: string | null
  onStartRename: (path: string) => void
  onCancelRename: () => void
  onFocusItem: (path: string) => void
}

const FileList = ({
  files,
  renamingPath,
  focusedItem,
  onStartRename,
  onCancelRename,
  onFocusItem
}: FileListProps): React.JSX.Element => {
  const { openFile, activeTabId, diffTabs, renameFile, deleteFile } = useWorkspace()
  const { scrollPathIntoView } = useSidebarDnd()
  const activeDiff = activeTabId?.startsWith('diff:')
    ? diffTabs.find((d) => d.id === activeTabId)
    : undefined
  return (
    <>
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          active={
            file.path === activeTabId ||
            (activeDiff != null &&
              (file.path === activeDiff.leftPath || file.path === activeDiff.rightPath))
          }
          focused={file.path === focusedItem}
          renaming={renamingPath === file.path}
          onActivate={() => openFile(file.path)}
          onFocusItem={() => onFocusItem(file.path)}
          onStartRename={() => onStartRename(file.path)}
          onCommitRename={async (newName) => {
            onCancelRename()
            const newPath = await renameFile(file.path, newName)
            scrollPathIntoView(newPath)
          }}
          onCancelRename={onCancelRename}
          onDelete={() => void deleteFile(file.path)}
        />
      ))}
    </>
  )
}

type SubfolderViewProps = {
  folder: FolderNode
  depth: number
  renamingPath: string | null
  renamingFolderPath: string | null
  expandedPaths: Set<string>
  focusedItem: string | null
  onToggleExpanded: (path: string) => void
  onStartRename: (path: string) => void
  onCancelRename: () => void
  onFocusItem: (path: string) => void
  onCreateSubfolder: (parentPath: string) => void
  onCommitFolderRename: (oldPath: string, newName: string) => void
  onCancelFolderRename: () => void
}

const SubfolderView = ({
  folder,
  depth,
  renamingPath,
  renamingFolderPath,
  expandedPaths,
  focusedItem,
  onToggleExpanded,
  onStartRename,
  onCancelRename,
  onFocusItem,
  onCreateSubfolder,
  onCommitFolderRename,
  onCancelFolderRename
}: SubfolderViewProps): React.JSX.Element => {
  const expanded = expandedPaths.has(folder.path)
  const focused = focusedItem === folder.path
  const paddingLeft = 8 + depth * 12
  const isEmpty = folder.files.length === 0 && folder.subfolders.length === 0
  const isRenaming = renamingFolderPath === folder.path
  const dnd = useSidebarDnd()
  // Suppress drop highlight when the user hovers the folder they're dragging
  // (no-op anyway, but it would look like a valid target otherwise).
  const isDropTarget = dnd.dragOverPath === folder.path && dnd.draggingPath !== folder.path

  if (isRenaming) {
    return (
      <FolderRenameInput
        initialValue={folder.name}
        depth={depth}
        onCommit={(newName) => onCommitFolderRename(folder.path, newName)}
        onCancel={onCancelFolderRename}
      />
    )
  }

  return (
    <div>
      <div className="group/folder relative flex items-center">
        <button
          data-sidebar-path={folder.path}
          draggable
          onDragStart={(e) => dnd.onItemDragStart(e, { kind: 'folder', path: folder.path })}
          onDragEnd={dnd.onItemDragEnd}
          onDragEnter={(e) => dnd.onTargetDragOver(e, folder.path, folder.path)}
          onDragOver={(e) => dnd.onTargetDragOver(e, folder.path, folder.path)}
          onDrop={(e) => dnd.onTargetDrop(e, folder.path)}
          onClick={() => {
            onFocusItem(folder.path)
            onToggleExpanded(folder.path)
          }}
          style={{ paddingLeft }}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md pr-2 py-1 text-left text-sm',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            'text-muted-foreground',
            focused && 'bg-sidebar-accent text-sidebar-accent-foreground',
            isDropTarget &&
              'bg-sidebar-accent/70 ring-1 ring-inset ring-primary/60 text-sidebar-accent-foreground'
          )}
        >
          <ChevronRightIcon
            className={cn(
              'size-3 shrink-0 transition-transform duration-150',
              expanded && 'rotate-90'
            )}
          />
          {expanded ? (
            <FolderOpenIcon className="size-3.5 shrink-0" />
          ) : (
            <FolderIcon className="size-3.5 shrink-0" />
          )}
          <TruncatedName>{folder.name}</TruncatedName>
        </button>
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            onCreateSubfolder(folder.path)
          }}
          className="absolute right-1 inline-flex items-center justify-center rounded-sm size-5 opacity-0 group-hover/folder:opacity-100 bg-sidebar-accent"
        >
          <PlusIcon className="size-3 text-muted-foreground" />
        </span>
      </div>

      {expanded && (
        <div>
          {isEmpty && (
            <div
              style={{ paddingLeft: paddingLeft + 16 }}
              className="py-1 text-[11px] text-muted-foreground"
            >
              Empty
            </div>
          )}

          {folder.subfolders.map((sub) => (
            <SubfolderView
              key={sub.path}
              folder={sub}
              depth={depth + 1}
              renamingPath={renamingPath}
              renamingFolderPath={renamingFolderPath}
              expandedPaths={expandedPaths}
              focusedItem={focusedItem}
              onToggleExpanded={onToggleExpanded}
              onStartRename={onStartRename}
              onCancelRename={onCancelRename}
              onFocusItem={onFocusItem}
              onCreateSubfolder={onCreateSubfolder}
              onCommitFolderRename={onCommitFolderRename}
              onCancelFolderRename={onCancelFolderRename}
            />
          ))}

          <div style={{ paddingLeft: 20 + (depth + 1) * 12 }}>
            <FileList
              files={folder.files}
              renamingPath={renamingPath}
              focusedItem={focusedItem}
              onStartRename={onStartRename}
              onCancelRename={onCancelRename}
              onFocusItem={onFocusItem}
            />
          </div>
        </div>
      )}
    </div>
  )
}

type SectionViewProps = {
  section: SidebarSection
  onRemove?: () => void
  renamingPath: string | null
  renamingFolderPath: string | null
  expandedPaths: Set<string>
  focusedItem: string | null
  showAll: boolean
  onToggleExpanded: (path: string) => void
  onStartRename: (path: string) => void
  onCancelRename: () => void
  onFocusItem: (path: string) => void
  onToggleShowAll: () => void
  onCreateSubfolder: (parentPath: string) => void
  onCommitFolderRename: (oldPath: string, newName: string) => void
  onCancelFolderRename: () => void
  /** Optional reorder handle. Rendered absolutely-positioned on the left
   *  edge, hidden until the section header is hovered. Supplied only for
   *  reorderable sections (user-added folders, not Drafts). */
  dragHandle?: React.ReactNode
  /** True while this section is being dragged — dim the whole row so the
   *  user can see it detaching from its slot. */
  isDragging?: boolean
}

const SectionView = ({
  section,
  onRemove,
  renamingPath,
  renamingFolderPath,
  expandedPaths,
  focusedItem,
  showAll,
  onToggleExpanded,
  onStartRename,
  onCancelRename,
  onFocusItem,
  onToggleShowAll,
  onCreateSubfolder,
  onCommitFolderRename,
  onCancelFolderRename,
  dragHandle,
  isDragging
}: SectionViewProps): React.JSX.Element => {
  const expanded = expandedPaths.has(section.id)
  const focused = focusedItem === section.id
  const { createDraft } = useWorkspace()
  const dnd = useSidebarDnd()
  const isDropTarget = section.path != null && dnd.dragOverPath === section.id

  const allFiles = section.files
  const files = showAll ? allFiles : allFiles.slice(0, INITIAL_VISIBLE)
  const hidden = allFiles.length - INITIAL_VISIBLE

  const [sectionMenuOpen, setSectionMenuOpen] = useState(false)

  // Sections are drop targets for their root folder (section.path). The
  // handler lives on the outer wrapper so drops anywhere in the section's
  // body — header, empty list, gaps between rows — land in the right place.
  const sectionDropProps = section.path
    ? {
        onDragEnter: (e: React.DragEvent): void =>
          dnd.onTargetDragOver(e, section.id, section.path!),
        onDragOver: (e: React.DragEvent): void =>
          dnd.onTargetDragOver(e, section.id, section.path!),
        onDrop: (e: React.DragEvent): void => dnd.onTargetDrop(e, section.path!)
      }
    : {}

  return (
    <div
      className={cn(
        'group/section relative mb-3 rounded-md transition-opacity',
        isDragging && 'opacity-50',
        isDropTarget && 'bg-sidebar-accent/30 ring-1 ring-inset ring-primary/60'
      )}
      {...sectionDropProps}
    >
      {dragHandle}
      <div className="group flex items-center gap-1 px-2 pt-1 pb-0.5">
        <button
          data-sidebar-path={section.id}
          onClick={() => {
            onFocusItem(section.id)
            onToggleExpanded(section.id)
          }}
          className={cn(
            'flex flex-1 items-center gap-1 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground',
            focused && 'text-foreground'
          )}
        >
          <ChevronRightIcon
            className={cn(
              'size-3 shrink-0 transition-transform duration-150',
              expanded && 'rotate-90'
            )}
          />
          <TruncatedName>{section.label}</TruncatedName>
        </button>

        {section.path && (
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-5 opacity-0 group-hover:opacity-100')}
            aria-label={`New folder in ${section.label}`}
            onClick={() => onCreateSubfolder(section.path!)}
          >
            <PlusIcon className="size-3" />
          </Button>
        )}

        <DropdownMenu open={sectionMenuOpen} onOpenChange={setSectionMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'size-5 opacity-0 group-hover:opacity-100',
                sectionMenuOpen && 'opacity-100'
              )}
              aria-label={`${section.label} options`}
            >
              <MoreHorizontalIcon className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            {section.isDrafts && (
              <DropdownMenuItem onSelect={createDraft}>
                <FilePlusIcon className="size-3.5" />
                New draft
              </DropdownMenuItem>
            )}
            {section.path && (
              <DropdownMenuItem onSelect={() => void window.api.revealInFolder(section.path!)}>
                <FolderOpenIcon className="size-3.5" />
                {revealLabel}
              </DropdownMenuItem>
            )}
            {!section.isDrafts && onRemove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  <FolderMinusIcon className="size-3.5" />
                  Remove folder
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && (
        <>
          {section.isDrafts && !section.path && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">
              Set a drafts folder in Settings to enable ⌘N.
            </div>
          )}

          {files.length === 0 && section.subfolders.length === 0 && section.path && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">No markdown files</div>
          )}

          <FileList
            files={files}
            renamingPath={renamingPath}
            focusedItem={focusedItem}
            onStartRename={onStartRename}
            onCancelRename={onCancelRename}
            onFocusItem={onFocusItem}
          />

          {section.subfolders.map((sub) => (
            <SubfolderView
              key={sub.path}
              folder={sub}
              depth={1}
              renamingPath={renamingPath}
              renamingFolderPath={renamingFolderPath}
              expandedPaths={expandedPaths}
              focusedItem={focusedItem}
              onToggleExpanded={onToggleExpanded}
              onStartRename={onStartRename}
              onCancelRename={onCancelRename}
              onFocusItem={onFocusItem}
              onCreateSubfolder={onCreateSubfolder}
              onCommitFolderRename={onCommitFolderRename}
              onCancelFolderRename={onCancelFolderRename}
            />
          ))}

          {hidden > 0 && !showAll && (
            <button
              onClick={onToggleShowAll}
              className="w-full px-2 py-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Show {hidden} more
            </button>
          )}
          {showAll && hidden > 0 && (
            <button
              onClick={onToggleShowAll}
              className="w-full px-2 py-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Show fewer
            </button>
          )}
        </>
      )}
    </div>
  )
}

type RecentsRowProps = {
  path: string
  active: boolean
  onOpen: () => void
  onRemove: () => void
}

const RecentsRow = ({ path, active, onOpen, onRemove }: RecentsRowProps): React.JSX.Element => {
  // Display name: basename minus .md extension, like regular file rows.
  const base = path.split('/').pop() ?? path
  const displayName = base.replace(/\.md$/i, '')
  return (
    <div className="group/row relative flex items-center">
      <button
        onClick={onOpen}
        title={path}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm',
          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
        )}
      >
        <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <TruncatedName>{displayName}</TruncatedName>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label={`Remove ${displayName} from recents`}
        className={cn(
          'absolute right-1 inline-flex items-center justify-center rounded-sm size-5',
          'opacity-0 group-hover/row:opacity-100 bg-sidebar-accent text-muted-foreground',
          'hover:text-foreground'
        )}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}

type RecentsSectionProps = {
  expanded: boolean
  onToggleExpanded: () => void
}

// Show the most-recent N first, then load 10 more per "Show more" click.
// MAX_RECENT_FILES in the store caps the total to 50, so the button naturally
// disappears once the user has paged through everything.
const RECENTS_INITIAL = 10
const RECENTS_PAGE = 10

const RecentsSection = ({ expanded, onToggleExpanded }: RecentsSectionProps): React.JSX.Element => {
  const recentFiles = useWorkspace((s) => s.recentFiles)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const diffTabs = useWorkspace((s) => s.diffTabs)
  const openFile = useWorkspace((s) => s.openFile)
  const openFileDialog = useWorkspace((s) => s.openFileDialog)
  const removeRecentFile = useWorkspace((s) => s.removeRecentFile)
  const clearRecentFiles = useWorkspace((s) => s.clearRecentFiles)
  const activeDiff = activeTabId?.startsWith('diff:')
    ? diffTabs.find((d) => d.id === activeTabId)
    : undefined
  const [menuOpen, setMenuOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(RECENTS_INITIAL)

  const visible = recentFiles.slice(0, visibleCount)
  const hasMore = recentFiles.length > visibleCount

  return (
    <div className="mb-3 rounded-md">
      <div className="group flex items-center gap-1 px-2 pt-1 pb-0.5">
        <button
          onClick={onToggleExpanded}
          className="flex flex-1 items-center gap-1 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
        >
          <ChevronRightIcon
            className={cn(
              'size-3 shrink-0 transition-transform duration-150',
              expanded && 'rotate-90'
            )}
          />
          <TruncatedName>Recents</TruncatedName>
        </button>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn('size-5 opacity-0 group-hover:opacity-100', menuOpen && 'opacity-100')}
              aria-label="Recents options"
            >
              <MoreHorizontalIcon className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            <DropdownMenuItem onSelect={() => void openFileDialog()}>
              <FolderOpenIcon className="size-3.5" />
              Open file…
            </DropdownMenuItem>
            {recentFiles.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={clearRecentFiles}>
                  <TrashIcon className="size-3.5" />
                  Clear recents
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded && (
        <>
          {recentFiles.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">
              Open any markdown file to see it here
            </div>
          )}
          {visible.map((path) => (
            <RecentsRow
              key={path}
              path={path}
              active={
                path === activeTabId ||
                (activeDiff != null &&
                  (path === activeDiff.leftPath || path === activeDiff.rightPath))
              }
              onOpen={() => void openFile(path)}
              onRemove={() => removeRecentFile(path)}
            />
          ))}
          {hasMore && (
            <button
              onClick={() => setVisibleCount((n) => n + RECENTS_PAGE)}
              className="block w-full rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            >
              Show {Math.min(RECENTS_PAGE, recentFiles.length - visibleCount)} more
            </button>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Sortable wrapper around `SectionView` for user-added top-level folders.
 * Provides the drag handle, wires up the sortable transforms, and forwards
 * the dragging flag so the section dims while detached.
 *
 * Drafts is rendered with `SectionView` directly (not wrapped) — it's a
 * sentinel pinned above the user-controlled folder list.
 */
const SortableSectionView = (props: SectionViewProps): React.JSX.Element => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.section.id
  })

  const style: React.CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    // Lift the dragged section above its neighbors so the drop-target
    // highlight on the underlying row doesn't bleed through the overlay.
    zIndex: isDragging ? 10 : undefined
  }

  // The handle is the ONLY drag trigger. PointerSensor on the handle + a
  // tolerance distance keeps a quick click-through-for-expand from being
  // misread as the start of a drag.
  const handle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Reorder ${props.section.label} section`}
      title="Drag to reorder"
      className={cn(
        'absolute left-0 top-[6px] z-10 inline-flex size-4 items-center justify-center rounded-sm',
        '-translate-x-[3px] text-muted-foreground/70 hover:text-foreground',
        'cursor-grab active:cursor-grabbing touch-none select-none',
        // Always a bit visible while dragging so the grabbed row stays legible;
        // otherwise reveal on section hover or keyboard focus.
        isDragging
          ? 'opacity-100'
          : 'opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100'
      )}
    >
      <GripVerticalIcon className="size-3" />
    </button>
  )

  return (
    <div ref={setNodeRef} style={style}>
      <SectionView {...props} dragHandle={handle} isDragging={isDragging} />
    </div>
  )
}

const Sidebar = (): React.JSX.Element => {
  const {
    sections,
    additionalFolders,
    addFolder,
    removeFolder,
    reorderAdditionalFolders,
    openSettings,
    openFile,
    createSubfolder,
    renameFolder,
    moveFile,
    moveFolder,
    collapsedSectionIds,
    expandedSubfolderPaths,
    toggleSidebarSection,
    toggleSidebarSubfolder,
    expandSidebarSections,
    collapseSidebarSection,
    expandSidebarSubfolders,
    collapseSidebarSubfolder
  } = useWorkspace()
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renamingFolderPath, setRenamingFolderPath] = useState<string | null>(null)
  const [focusedItem, setFocusedItem] = useState<string | null>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const [showAllSections, setShowAllSections] = useState<Set<string>>(new Set())

  const expandedPaths = useMemo(() => {
    const all = new Set<string>()
    for (const s of sections) {
      if (!collapsedSectionIds.has(s.id)) all.add(s.id)
    }
    for (const p of expandedSubfolderPaths) all.add(p)
    return all
  }, [sections, collapsedSectionIds, expandedSubfolderPaths])

  // Whether `key` refers to a top-level section (id) vs a nested subfolder (path).
  // Section IDs match either RECENTS_ID or one of the section.id values.
  const isSectionKey = useCallback(
    (key: string): boolean => key === RECENTS_ID || sections.some((s) => s.id === key),
    [sections]
  )

  const toggleExpanded = useCallback(
    (key: string) => {
      if (isSectionKey(key)) toggleSidebarSection(key)
      else toggleSidebarSubfolder(key)
    },
    [isSectionKey, toggleSidebarSection, toggleSidebarSubfolder]
  )

  const toggleShowAll = useCallback((sectionId: string) => {
    setShowAllSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  const flatItems = useMemo(
    () => flattenVisibleTree(sections, expandedPaths, showAllSections),
    [sections, expandedPaths, showAllSections]
  )

  const activeFocusedItem = useMemo(
    () => (focusedItem && flatItems.some((i) => i.path === focusedItem) ? focusedItem : null),
    [focusedItem, flatItems]
  )

  useEffect(() => {
    if (!activeFocusedItem) return
    const el = sidebarRef.current?.querySelector(
      `[data-sidebar-path="${CSS.escape(activeFocusedItem)}"]`
    )
    ;(el as HTMLElement)?.scrollIntoView({ block: 'nearest' })
  }, [activeFocusedItem])

  // Deferred to the next frame so React has committed the resorted list and
  // the target row exists in the DOM at its new alphabetical slot.
  const scrollPathIntoView = useCallback((path: string) => {
    requestAnimationFrame(() => {
      const el = sidebarRef.current?.querySelector(`[data-sidebar-path="${CSS.escape(path)}"]`)
      ;(el as HTMLElement | null)?.scrollIntoView({ block: 'nearest' })
    })
  }, [])

  const handleFocusItem = useCallback((path: string) => {
    setFocusedItem(path)
    sidebarRef.current?.focus()
  }, [])

  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setFocusedItem(null)
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!activeFocusedItem || renamingPath) return

      const idx = flatItems.findIndex((i) => i.path === activeFocusedItem)
      if (idx === -1) return
      const item = flatItems[idx]

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          if (idx < flatItems.length - 1) setFocusedItem(flatItems[idx + 1].path)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (idx > 0) setFocusedItem(flatItems[idx - 1].path)
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          if (item.type === 'section' || item.type === 'folder') {
            if (!expandedPaths.has(item.path)) {
              if (item.type === 'section') expandSidebarSections(item.path)
              else expandSidebarSubfolders(item.path)
            } else {
              const next = flatItems[idx + 1]
              if (next && next.parentPath === item.path) {
                setFocusedItem(next.path)
              }
            }
          }
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          if ((item.type === 'section' || item.type === 'folder') && expandedPaths.has(item.path)) {
            if (item.type === 'section') collapseSidebarSection(item.path)
            else collapseSidebarSubfolder(item.path)
          } else if (item.parentPath) {
            setFocusedItem(item.parentPath)
          }
          break
        }
        case 'Enter': {
          e.preventDefault()
          if (item.type === 'file') {
            void openFile(item.path)
            setFocusedItem(null)
            sidebarRef.current?.blur()
          } else {
            toggleExpanded(item.path)
          }
          break
        }
        case 'Escape': {
          e.preventDefault()
          setFocusedItem(null)
          sidebarRef.current?.blur()
          break
        }
        case 'F2': {
          e.preventDefault()
          if (item.type === 'file') setRenamingPath(item.path)
          else if (item.type === 'folder') setRenamingFolderPath(item.path)
          break
        }
      }
    },
    [
      activeFocusedItem,
      flatItems,
      expandedPaths,
      toggleExpanded,
      expandSidebarSections,
      collapseSidebarSection,
      expandSidebarSubfolders,
      collapseSidebarSubfolder,
      openFile,
      renamingPath
    ]
  )

  const handleCreateSubfolder = useCallback(
    async (parentPath: string): Promise<void> => {
      let containingSection: SidebarSection | null = null
      for (const s of sections) {
        if (s.path && (parentPath === s.path || parentPath.startsWith(s.path + '/'))) {
          containingSection = s
          break
        }
      }
      if (containingSection) expandSidebarSections(containingSection.id)
      // If parentPath equals the section's root, the new folder lives directly
      // under the section and parentPath isn't a subfolder we need to expand.
      if (!containingSection || parentPath !== containingSection.path) {
        expandSidebarSubfolders(parentPath)
      }
      try {
        const newPath = await createSubfolder(parentPath)
        setRenamingFolderPath(newPath)
        scrollPathIntoView(newPath)
      } catch {
        // Directory may already exist or other FS error
      }
    },
    [createSubfolder, sections, expandSidebarSections, expandSidebarSubfolders, scrollPathIntoView]
  )

  const handleCommitFolderRename = useCallback(
    async (oldPath: string, newName: string): Promise<void> => {
      setRenamingFolderPath(null)
      try {
        const newPath = await renameFolder(oldPath, newName)
        scrollPathIntoView(newPath)
      } catch {
        // Name conflict or FS error — section will refresh and show original name
      }
    },
    [renameFolder, scrollPathIntoView]
  )

  const handleCancelFolderRename = useCallback(() => {
    setRenamingFolderPath(null)
  }, [])

  const handleAddFolder = async (): Promise<void> => {
    const chosen = await window.api.openDirectory()
    if (chosen) await addFolder(chosen)
  }

  // --- Drag and drop ------------------------------------------------------
  // We store the drag payload on the DataTransfer (read on drop) AND in a ref
  // so targets can check self-drop without awaiting the async read — during
  // dragover the browser hides the payload, exposing only the MIME type.
  const dragPayloadRef = useRef<DragPayload | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [draggingPath, setDraggingPath] = useState<string | null>(null)

  const onItemDragStart = useCallback((e: React.DragEvent, payload: DragPayload): void => {
    e.dataTransfer.setData(DND_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
    dragPayloadRef.current = payload
    setDraggingPath(payload.path)
  }, [])

  const onItemDragEnd = useCallback((): void => {
    dragPayloadRef.current = null
    setDraggingPath(null)
    setDragOverPath(null)
  }, [])

  // Decide whether a given target is a legal drop for the current drag.
  // Same-folder (no-op) and folder-into-self/descendant are rejected.
  const isLegalDrop = useCallback((targetDir: string): boolean => {
    const payload = dragPayloadRef.current
    if (!payload) return false
    const currentParent = payload.path.slice(0, payload.path.lastIndexOf('/'))
    if (currentParent === targetDir) return false
    if (payload.kind === 'folder') {
      if (targetDir === payload.path || targetDir.startsWith(payload.path + '/')) return false
    }
    return true
  }, [])

  // Setting dragOverPath on every dragover (continuous) means the innermost
  // target always wins (stopPropagation keeps the outer section from
  // reclaiming), and moving from a child back into parent body clears the
  // child claim naturally — parent's next dragover takes over.
  const onTargetDragOver = useCallback(
    (e: React.DragEvent, targetPath: string, destDir: string): void => {
      if (!e.dataTransfer.types.includes(DND_MIME)) return
      e.preventDefault()
      e.stopPropagation()
      setDragOverPath((prev) => (prev === targetPath ? prev : targetPath))
      e.dataTransfer.dropEffect = isLegalDrop(destDir) ? 'move' : 'none'
    },
    [isLegalDrop]
  )

  const onTargetDrop = useCallback(
    (e: React.DragEvent, destDir: string): void => {
      e.preventDefault()
      e.stopPropagation()
      const raw = e.dataTransfer.getData(DND_MIME)
      setDragOverPath(null)
      if (!raw) return
      let payload: DragPayload
      try {
        payload = JSON.parse(raw) as DragPayload
      } catch {
        return
      }
      if (!isLegalDrop(destDir)) return
      if (payload.kind === 'file') void moveFile(payload.path, destDir)
      else void moveFolder(payload.path, destDir)
    },
    [isLegalDrop, moveFile, moveFolder]
  )

  const dndContextValue = useMemo<DndContext>(
    () => ({
      dragOverPath,
      draggingPath,
      onItemDragStart,
      onItemDragEnd,
      onTargetDragOver,
      onTargetDrop,
      scrollPathIntoView
    }),
    [
      dragOverPath,
      draggingPath,
      onItemDragStart,
      onItemDragEnd,
      onTargetDragOver,
      onTargetDrop,
      scrollPathIntoView
    ]
  )

  // --- Top-level folder reordering (dnd-kit) -------------------------------
  // We use dnd-kit for reordering sections (not HTML5 drag) because the rest
  // of the sidebar already speaks native drag events for file/folder moves.
  // Pointer activation is gated on the section's grip handle so quick clicks
  // on the section header stay free to expand/collapse. 4px distance absorbs
  // unintentional micro-movements during a click.
  const sortableSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleSectionDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const fromIndex = additionalFolders.indexOf(active.id as string)
      const toIndex = additionalFolders.indexOf(over.id as string)
      if (fromIndex === -1 || toIndex === -1) return
      void reorderAdditionalFolders(fromIndex, toIndex)
    },
    [additionalFolders, reorderAdditionalFolders]
  )

  // Drafts is pinned above the user-reorderable folder list. Splitting the
  // array here keeps the sortable concerns isolated to the part that should
  // actually move.
  const draftsSection = sections.find((s) => s.isDrafts)
  const additionalSections = sections.filter((s) => !s.isDrafts)

  const sectionCommonProps = {
    renamingPath,
    renamingFolderPath,
    expandedPaths,
    focusedItem: activeFocusedItem,
    onToggleExpanded: toggleExpanded,
    onStartRename: setRenamingPath,
    onCancelRename: () => setRenamingPath(null),
    onFocusItem: handleFocusItem,
    onCreateSubfolder: handleCreateSubfolder,
    onCommitFolderRename: handleCommitFolderRename,
    onCancelFolderRename: handleCancelFolderRename
  }

  return (
    <SidebarDndContext.Provider value={dndContextValue}>
      <div
        ref={sidebarRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="flex h-full flex-col bg-sidebar text-sidebar-foreground outline-none"
      >
        <ScrollArea className="min-h-0 flex-1 pl-1 pr-2.5 pt-2">
          <RecentsSection
            expanded={!collapsedSectionIds.has(RECENTS_ID)}
            onToggleExpanded={() => toggleSidebarSection(RECENTS_ID)}
          />
          {draftsSection && (
            <SectionView
              key={draftsSection.id}
              section={draftsSection}
              showAll={showAllSections.has(draftsSection.id)}
              onToggleShowAll={() => toggleShowAll(draftsSection.id)}
              {...sectionCommonProps}
            />
          )}
          <DndKitContext
            sensors={sortableSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleSectionDragEnd}
          >
            <SortableContext items={additionalFolders} strategy={verticalListSortingStrategy}>
              {additionalSections.map((section) => (
                <SortableSectionView
                  key={section.id}
                  section={section}
                  showAll={showAllSections.has(section.id)}
                  onToggleShowAll={() => toggleShowAll(section.id)}
                  onRemove={() => void removeFolder(section.path ?? section.id)}
                  {...sectionCommonProps}
                />
              ))}
            </SortableContext>
          </DndKitContext>
        </ScrollArea>

        <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 justify-start gap-2 px-2 text-xs"
            onClick={handleAddFolder}
          >
            <FolderPlusIcon className="size-3.5" />
            Add folder
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={openSettings}
            aria-label="Settings"
          >
            <SettingsIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </SidebarDndContext.Provider>
  )
}

export default Sidebar
