import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FilePlusIcon,
  FolderPlusIcon,
  FileTextIcon,
  PencilIcon,
  TrashIcon,
  MoreHorizontalIcon,
  SettingsIcon,
  FolderMinusIcon,
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  PlusIcon
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

const isMac = navigator.platform.startsWith('Mac')

const revealLabel = navigator.platform.startsWith('Win')
  ? 'Show in Explorer'
  : isMac
    ? 'Reveal in Finder'
    : 'Show in file manager'

const isModClick = (e: React.MouseEvent): boolean => (isMac ? e.metaKey : e.ctrlKey)

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

    for (const sub of section.subfolders) walkFolder(sub, section.id)

    const allFiles = section.files
    const visible = showAllSections.has(section.id) ? allFiles : allFiles.slice(0, INITIAL_VISIBLE)
    for (const file of visible) {
      items.push({ path: file.path, type: 'file', parentPath: section.id })
    }
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
          onClick={(e) => {
            if (isModClick(e)) {
              e.preventDefault()
              onFocusItem()
            } else {
              onActivate()
            }
          }}
          onDoubleClick={onStartRename}
          className={cn(
            'group/row flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
            focused && 'ring-1 ring-inset ring-ring'
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
                  'inline-flex shrink-0 items-center justify-center rounded-sm size-5',
                  'opacity-0 group-hover/row:opacity-100 hover:bg-sidebar-accent',
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
  const { openFile, activeTabId, renameFile, deleteFile } = useWorkspace()
  return (
    <>
      {files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          active={file.path === activeTabId}
          focused={file.path === focusedItem}
          renaming={renamingPath === file.path}
          onActivate={() => openFile(file.path)}
          onFocusItem={() => onFocusItem(file.path)}
          onStartRename={() => onStartRename(file.path)}
          onCommitRename={async (newName) => {
            onCancelRename()
            await renameFile(file.path, newName)
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
          onClick={(e) => {
            if (isModClick(e)) {
              e.preventDefault()
              onFocusItem(folder.path)
            } else {
              onToggleExpanded(folder.path)
            }
          }}
          style={{ paddingLeft }}
          className={cn(
            'flex w-full items-center gap-1.5 rounded-md pr-7 py-1 text-left text-sm',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            'text-muted-foreground',
            focused && 'ring-1 ring-inset ring-ring'
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
          className="absolute right-1 inline-flex shrink-0 items-center justify-center rounded-sm size-5 opacity-0 group-hover/folder:opacity-100 hover:bg-sidebar-accent"
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
  onCancelFolderRename
}: SectionViewProps): React.JSX.Element => {
  const expanded = expandedPaths.has(section.id)
  const focused = focusedItem === section.id
  const { createDraft } = useWorkspace()

  const allFiles = section.files
  const files = showAll ? allFiles : allFiles.slice(0, INITIAL_VISIBLE)
  const hidden = allFiles.length - INITIAL_VISIBLE

  const [sectionMenuOpen, setSectionMenuOpen] = useState(false)

  return (
    <div className="mb-3">
      <div className="group flex items-center gap-1 px-2 pt-1 pb-0.5">
        <button
          data-sidebar-path={section.id}
          onClick={(e) => {
            if (isModClick(e)) {
              e.preventDefault()
              onFocusItem(section.id)
            } else {
              onToggleExpanded(section.id)
            }
          }}
          className={cn(
            'flex flex-1 items-center gap-1 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground',
            focused && 'ring-1 ring-inset ring-ring rounded-sm'
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

          <FileList
            files={files}
            renamingPath={renamingPath}
            focusedItem={focusedItem}
            onStartRename={onStartRename}
            onCancelRename={onCancelRename}
            onFocusItem={onFocusItem}
          />

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

const Sidebar = (): React.JSX.Element => {
  const {
    sections,
    addFolder,
    removeFolder,
    openSettings,
    openFile,
    createSubfolder,
    renameFolder,
    sidebarCollapsedPaths,
    toggleSidebarCollapsedPath,
    expandSidebarPaths,
    collapseSidebarPath
  } = useWorkspace()
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renamingFolderPath, setRenamingFolderPath] = useState<string | null>(null)
  const [focusedItem, setFocusedItem] = useState<string | null>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)

  const [showAllSections, setShowAllSections] = useState<Set<string>>(new Set())

  const expandedPaths = useMemo(() => {
    const all = new Set<string>()
    const walk = (node: FolderNode): void => {
      all.add(node.path)
      for (const sub of node.subfolders) walk(sub)
    }
    for (const s of sections) {
      all.add(s.id)
      for (const sub of s.subfolders) walk(sub)
    }
    for (const p of sidebarCollapsedPaths) all.delete(p)
    return all
  }, [sections, sidebarCollapsedPaths])

  const toggleExpanded = useCallback(
    (path: string) => {
      toggleSidebarCollapsedPath(path)
    },
    [toggleSidebarCollapsedPath]
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
              expandSidebarPaths(item.path)
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
            collapseSidebarPath(item.path)
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
      }
    },
    [
      activeFocusedItem,
      flatItems,
      expandedPaths,
      toggleExpanded,
      expandSidebarPaths,
      collapseSidebarPath,
      openFile,
      renamingPath
    ]
  )

  const handleCreateSubfolder = useCallback(
    async (parentPath: string): Promise<void> => {
      const pathsToExpand: string[] = [parentPath]
      for (const s of sections) {
        if (s.path && (parentPath === s.path || parentPath.startsWith(s.path + '/'))) {
          pathsToExpand.push(s.id)
          break
        }
      }
      expandSidebarPaths(...pathsToExpand)
      try {
        const newPath = await createSubfolder(parentPath)
        setRenamingFolderPath(newPath)
      } catch {
        // Directory may already exist or other FS error
      }
    },
    [createSubfolder, sections, expandSidebarPaths]
  )

  const handleCommitFolderRename = useCallback(
    async (oldPath: string, newName: string): Promise<void> => {
      setRenamingFolderPath(null)
      try {
        await renameFolder(oldPath, newName)
      } catch {
        // Name conflict or FS error — section will refresh and show original name
      }
    },
    [renameFolder]
  )

  const handleCancelFolderRename = useCallback(() => {
    setRenamingFolderPath(null)
  }, [])

  const handleAddFolder = async (): Promise<void> => {
    const chosen = await window.api.openDirectory()
    if (chosen) await addFolder(chosen)
  }

  return (
    <div
      ref={sidebarRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      className="flex h-full flex-col bg-sidebar text-sidebar-foreground outline-none"
    >
      <ScrollArea className="flex-1 px-1 pt-2">
        {sections.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            renamingPath={renamingPath}
            renamingFolderPath={renamingFolderPath}
            expandedPaths={expandedPaths}
            focusedItem={activeFocusedItem}
            showAll={showAllSections.has(section.id)}
            onToggleExpanded={toggleExpanded}
            onStartRename={setRenamingPath}
            onCancelRename={() => setRenamingPath(null)}
            onFocusItem={handleFocusItem}
            onToggleShowAll={() => toggleShowAll(section.id)}
            onCreateSubfolder={handleCreateSubfolder}
            onCommitFolderRename={handleCommitFolderRename}
            onCancelFolderRename={handleCancelFolderRename}
            onRemove={
              section.isDrafts ? undefined : () => void removeFolder(section.path ?? section.id)
            }
          />
        ))}
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
  )
}

export default Sidebar
