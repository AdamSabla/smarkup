import { useEffect, useMemo, useRef, useState } from 'react'
import Fuse from 'fuse.js'
import { FileTextIcon, SearchIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

type PaletteItem = {
  path: string
  name: string
  displayName: string
  folder: string
  isRecent?: boolean
}

/**
 * Inner body — only mounted while the dialog is open, so useState()
 * re-initializes each time and we don't need a reset-on-open effect.
 */
const QuickOpenBody = (): React.JSX.Element => {
  const { closeQuickOpen, sections, openFile, recentFiles } = useWorkspace()

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Flatten all files from all sections into one searchable list
  const items = useMemo<PaletteItem[]>(() => {
    const result: PaletteItem[] = []
    const byPath = new Map<string, PaletteItem>()
    for (const section of sections) {
      for (const file of section.files) {
        const item: PaletteItem = {
          path: file.path,
          name: file.name,
          displayName: file.name.replace(/\.md$/i, ''),
          folder: section.label
        }
        byPath.set(file.path, item)
        result.push(item)
      }
    }
    // Attach any recent files that aren't in the sidebar so they are still searchable
    for (const recent of recentFiles) {
      if (!byPath.has(recent)) {
        const name = recent.split('/').pop() ?? recent
        result.push({
          path: recent,
          name,
          displayName: name.replace(/\.md$/i, ''),
          folder: 'Recent'
        })
      }
    }
    return result
  }, [sections, recentFiles])

  // Recent-first list used when the query is empty
  const recentItems = useMemo<PaletteItem[]>(() => {
    const byPath = new Map(items.map((i) => [i.path, i]))
    const recent: PaletteItem[] = []
    for (const path of recentFiles) {
      const match = byPath.get(path)
      if (match) recent.push({ ...match, isRecent: true })
    }
    return recent
  }, [items, recentFiles])

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: ['displayName', 'name', 'folder'],
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true
      }),
    [items]
  )

  const results = useMemo<PaletteItem[]>(() => {
    if (!query.trim()) {
      // Empty query → show recent files first, then the rest of the file list
      const recentPaths = new Set(recentItems.map((r) => r.path))
      const rest = items.filter((i) => !recentPaths.has(i.path)).slice(0, 50 - recentItems.length)
      return [...recentItems, ...rest]
    }
    return fuse
      .search(query)
      .map((r) => r.item)
      .slice(0, 50)
  }, [query, items, fuse, recentItems])

  // Derived: active index clamped to current result length — no effect needed
  const clampedIndex = Math.min(activeIndex, Math.max(0, results.length - 1))

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // Ensure active item is visible
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${clampedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [clampedIndex])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(Math.min(clampedIndex + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(Math.max(clampedIndex - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = results[clampedIndex]
      if (item) {
        void openFile(item.path)
        closeQuickOpen()
      }
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search files…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1">
        {results.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">No files match</div>
        )}
        {!query.trim() && recentItems.length > 0 && (
          <div className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Recent
          </div>
        )}
        {results.map((item, idx) => {
          const active = idx === clampedIndex
          const firstNonRecent =
            !query.trim() && recentItems.length > 0 && idx === recentItems.length && !item.isRecent
          return (
            <div key={item.path}>
              {firstNonRecent && (
                <div className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  All files
                </div>
              )}
              <button
                data-index={idx}
                onClick={() => {
                  void openFile(item.path)
                  closeQuickOpen()
                }}
                onMouseMove={() => setActiveIndex(idx)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2 text-left text-sm',
                  active && 'bg-accent text-accent-foreground'
                )}
              >
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.folder}</div>
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

const QuickOpen = (): React.JSX.Element => {
  const quickOpenOpen = useWorkspace((s) => s.quickOpenOpen)
  const closeQuickOpen = useWorkspace((s) => s.closeQuickOpen)

  return (
    <Dialog open={quickOpenOpen} onOpenChange={(open) => !open && closeQuickOpen()}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search files</DialogTitle>
        <DialogDescription className="sr-only">
          Fuzzy search across all files in your sidebar.
        </DialogDescription>
        {quickOpenOpen && <QuickOpenBody />}
      </DialogContent>
    </Dialog>
  )
}

export default QuickOpen
