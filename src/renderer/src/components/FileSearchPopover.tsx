import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Command as CommandPrimitive } from 'cmdk'
import { SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace, type SidebarSection, type FolderNode } from '@/store/workspace'

type FileOption = { path: string; name: string; folder: string }

/** Recursively collect all .md files from a sidebar section. */
function collectFiles(section: SidebarSection): FileOption[] {
  const out: FileOption[] = []
  const walk = (files: SidebarSection['files'], subfolders: FolderNode[], prefix: string): void => {
    for (const f of files) {
      out.push({ path: f.path, name: f.name, folder: prefix })
    }
    for (const sf of subfolders) {
      walk(sf.files, sf.subfolders, prefix ? `${prefix}/${sf.name}` : sf.name)
    }
  }
  walk(section.files, section.subfolders, section.label)
  return out
}

type Props = {
  /** Currently selected file path (shown as the trigger label). */
  value: string | null
  /** Called when the user picks a file. */
  onSelect: (path: string) => void
  /** Additional class on the wrapper. */
  className?: string
  /** Alignment of the dropdown. */
  align?: 'left' | 'right'
  /** Visual style: "inline" (no border, for diff headers) or "outlined" (with border, for dialogs). */
  variant?: 'inline' | 'outlined'
}

const FileSearchPopover = ({
  value,
  onSelect,
  className,
  align = 'left',
  variant = 'inline'
}: Props): React.JSX.Element => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)

  const tabs = useWorkspace((s) => s.tabs)
  const sections = useWorkspace((s) => s.sections)

  // Build a deduplicated flat list of all available files
  const allFiles = useMemo(() => {
    const seen = new Set<string>()
    const result: FileOption[] = []
    // Open tabs first
    for (const t of tabs) {
      if (!seen.has(t.path)) {
        seen.add(t.path)
        const parts = t.path.split('/')
        result.push({
          path: t.path,
          name: t.name,
          folder: parts.length > 2 ? parts[parts.length - 2] : ''
        })
      }
    }
    // Then all sidebar files
    for (const sec of sections) {
      for (const f of collectFiles(sec)) {
        if (!seen.has(f.path)) {
          seen.add(f.path)
          result.push(f)
        }
      }
    }
    return result
  }, [tabs, sections])

  const selectedName = useMemo(() => {
    if (!value) return 'Select a file...'
    const found = allFiles.find((f) => f.path === value)
    return found?.name ?? value.split('/').pop() ?? value
  }, [value, allFiles])

  const handleSelect = useCallback(
    (path: string) => {
      onSelect(path)
      setOpen(false)
      setSearch('')
    },
    [onSelect]
  )

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Position the portal dropdown relative to the button
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    if (align === 'right') {
      // Right-align: dropdown's right edge aligns with button's right edge
      setDropdownPos({ top: rect.bottom + 4, left: Math.max(4, rect.right - 288) })
    } else {
      setDropdownPos({ top: rect.bottom + 4, left: rect.left })
    }
  }, [open, align])

  const dropdownContent = (
    <CommandPrimitive shouldFilter>
      <div className="flex h-9 items-center gap-2 border-b px-2">
        <SearchIcon className="size-3.5 shrink-0 opacity-50" />
        <CommandPrimitive.Input
          ref={inputRef}
          value={search}
          onValueChange={setSearch}
          placeholder="Search files..."
          className="flex h-9 w-full bg-transparent text-xs outline-hidden placeholder:text-muted-foreground"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              setSearch('')
            }
          }}
        />
      </div>
      <CommandPrimitive.List className="max-h-52 overflow-y-auto p-1">
        <CommandPrimitive.Empty className="py-4 text-center text-xs text-muted-foreground">
          No files found
        </CommandPrimitive.Empty>
        {allFiles.map((f) => (
          <CommandPrimitive.Item
            key={f.path}
            value={`${f.name} ${f.folder}`}
            onSelect={() => handleSelect(f.path)}
            className={cn(
              'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-hidden select-none',
              'data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
              f.path === value && 'font-medium'
            )}
          >
            <span className="flex-1 truncate">{f.name}</span>
            {f.folder && (
              <span className="shrink-0 text-[10px] text-muted-foreground">{f.folder}</span>
            )}
          </CommandPrimitive.Item>
        ))}
      </CommandPrimitive.List>
    </CommandPrimitive>
  )

  // For "outlined" variant (dialog usage), render dropdown inline (no portal)
  // so it stays within the dialog's DOM and doesn't cause the dialog to close.
  // For "inline" variant (diff header), use a portal to escape overflow-hidden.
  const usePortal = variant === 'inline'

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-7 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
          variant === 'outlined'
            ? 'border border-border bg-background hover:bg-muted hover:text-foreground'
            : 'hover:bg-muted hover:text-foreground',
          open && 'bg-muted text-foreground'
        )}
        title={value ?? undefined}
      >
        <span className="max-w-[200px] truncate">{selectedName}</span>
        <svg className="size-3 opacity-50" viewBox="0 0 16 16" fill="currentColor">
          <path
            d="M4.5 6.5l3.5 3.5 3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open &&
        usePortal &&
        dropdownPos &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-50 w-72 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {dropdownContent}
          </div>,
          document.body
        )}

      {open && !usePortal && (
        <div
          ref={dropdownRef}
          className={cn(
            'absolute top-full z-50 mt-1 w-72 overflow-hidden rounded-md border border-border bg-popover shadow-lg',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {dropdownContent}
        </div>
      )}
    </div>
  )
}

export default FileSearchPopover
