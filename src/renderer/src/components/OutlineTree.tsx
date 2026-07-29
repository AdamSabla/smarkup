import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  BracesIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CornerDownLeftIcon,
  PinIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { descendantCount } from '@/lib/outline'
import {
  INDENT,
  canShiftLevel,
  dropEdit,
  foldableRows,
  foldsToLevel,
  moveSiblingEdit,
  planDrop,
  shiftLevelEdit,
  subtreePartials,
  subtreeWords,
  visibleIndices,
  type OutlineEdit,
  type OutlineRow
} from '@/lib/outline-tree'

export type OutlineTreeHandle = { focus: () => void }

type OutlineTreeProps = {
  rows: OutlineRow[]
  /** Index of the row the keyboard acts on. */
  sel: number
  onSelChange: (index: number) => void
  folded: Set<number>
  onFoldedChange: (next: Set<number>) => void
  /** A drag, an ⌥↑↓ move, or a level shift. Never called with a no-op edit. */
  onEdit: (edit: NonNullable<OutlineEdit>) => void
  /** Enter, double-click, or the go-to button on a row. */
  onActivate: (index: number) => void
  /** Tooltip for the go-to button — the dialog warns that it applies first. */
  activateTitle?: string
  /** Row the editor is currently sitting in, highlighted but not selected. */
  currentIndex?: number | null
  /** Everything before the first heading, shown as a pinned row. */
  intro?: { preview: string; words: number } | null
  onActivateIntro?: () => void
  /** Tighter rows and smaller type, for the narrow docked panel. */
  dense?: boolean
  /** Per-section word counts. Dropped when the list is too narrow to spare
   *  the room — the titles are what you navigate by. */
  showWords?: boolean
  className?: string
}

/**
 * The outline itself: a draggable, foldable list of sections shared by the
 * modal and the docked panel.
 *
 * It owns view state that only matters while you're looking at it (drag,
 * scroll-into-view) and reports every document change as an `OutlineEdit` for
 * the host to deal with — the modal stages them, the panel writes them
 * straight to the buffer.
 */
const OutlineTree = forwardRef<OutlineTreeHandle, OutlineTreeProps>(
  (
    {
      rows,
      sel,
      onSelChange,
      folded,
      onFoldedChange,
      onEdit,
      onActivate,
      activateTitle = 'Go to heading',
      currentIndex = null,
      intro = null,
      onActivateIntro,
      dense = false,
      showWords = true,
      className
    },
    ref
  ) => {
    const listRef = useRef<HTMLDivElement>(null)
    const rectsRef = useRef<{ index: number; mid: number }[] | null>(null)
    const rafRef = useRef(0)
    /** Which row is being dragged, and the gap it would land in. */
    const [{ dragIndex, gap }, setDrag] = useState({ dragIndex: -1, gap: -1 })
    const setDragState = useCallback((nextIndex: number, nextGap: number) => {
      setDrag((d) =>
        d.dragIndex === nextIndex && d.gap === nextGap ? d : { dragIndex: nextIndex, gap: nextGap }
      )
    }, [])

    useImperativeHandle(ref, () => ({ focus: () => listRef.current?.focus() }), [])

    const visible = useMemo(() => visibleIndices(rows, folded), [rows, folded])

    const toggleFold = useCallback(
      (id: number) => {
        const next = new Set(folded)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        onFoldedChange(next)
      },
      [folded, onFoldedChange]
    )

    // A collapse can hide the selected row. Walking up to its nearest visible
    // ancestor keeps ↑↓ and the level buttons pointing at something on screen.
    useEffect(() => {
      if (visible.includes(sel) || rows.length === 0) return
      for (let i = sel - 1; i >= 0; i--) {
        if (visible.includes(i)) {
          onSelChange(i)
          return
        }
      }
      onSelChange(visible[0] ?? 0)
    }, [visible, sel, rows.length, onSelChange])

    // Keep the selected row — and the row the editor is parked in — reachable
    // without scrolling by hand.
    useEffect(() => {
      const target = document.activeElement === listRef.current ? sel : currentIndex
      if (target == null || target < 0) return
      listRef.current
        ?.querySelector<HTMLElement>(`[data-row-index="${target}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }, [sel, currentIndex])

    // --- Drag --------------------------------------------------------------
    // Row midpoints are measured once per drag and the dragover handler is
    // throttled to a frame, so pointer movement never triggers a re-render
    // unless the target gap actually changed.
    const onDragStart = (index: number) => (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      setDragState(index, -1)
      onSelChange(index)
      requestAnimationFrame(() => {
        const nodes = listRef.current?.querySelectorAll<HTMLElement>('[data-row-index]')
        rectsRef.current = nodes
          ? Array.from(nodes).map((el) => {
              const r = el.getBoundingClientRect()
              return { index: Number(el.dataset.rowIndex), mid: r.top + r.height / 2 }
            })
          : null
      })
    }

    const onDragOver = (e: React.DragEvent): void => {
      e.preventDefault()
      if (dragIndex < 0 || rafRef.current) return
      const y = e.clientY
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        const rects = rectsRef.current
        if (!rects) return
        let target = rows.length
        for (const r of rects) {
          if (y < r.mid) {
            target = r.index
            break
          }
        }
        const span = descendantCount(rows, dragIndex) + 1
        if (target > dragIndex && target <= dragIndex + span) target = dragIndex + span
        setDragState(dragIndex, target)
      })
    }

    const endDrag = (): void => {
      setDragState(-1, -1)
      rectsRef.current = null
    }

    const onDrop = (e: React.DragEvent): void => {
      e.preventDefault()
      const from = dragIndex
      const to = gap
      endDrag()
      if (from < 0 || to < 0) return
      const edit = dropEdit(rows, from, to)
      if (edit) onEdit(edit)
    }

    const drop = dragIndex >= 0 && gap >= 0 ? planDrop(rows, dragIndex, gap) : null

    // --- Keyboard ----------------------------------------------------------
    // Only the keys the tree owns are handled (and prevented); everything else
    // bubbles to the host, which layers on its own (⌘Z, ⌘↩, Escape…).
    const onKeyDown = (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onActivate(sel)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (e.altKey) {
          const edit = moveSiblingEdit(rows, sel, e.key === 'ArrowUp' ? -1 : 1)
          if (edit) onEdit(edit)
          return
        }
        const at = visible.indexOf(sel)
        const next = visible[at + (e.key === 'ArrowDown' ? 1 : -1)]
        if (next != null) onSelChange(next)
        return
      }
      // Left/right fold and unfold only — deliberately never change the level,
      // which is a document edit and belongs on an explicit control.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const row = rows[sel]
        if (!row || descendantCount(rows, sel) === 0) return
        const isFolded = folded.has(row.id)
        if (e.key === 'ArrowRight' && isFolded) toggleFold(row.id)
        if (e.key === 'ArrowLeft' && !isFolded) toggleFold(row.id)
      }
    }

    const dropMarker = (level: number, parent: string | null): React.JSX.Element => (
      <div className="flex items-center gap-1.5" style={{ marginLeft: (level - 1) * INDENT }}>
        <span className="rounded-sm bg-primary px-1 font-mono text-[10px] text-primary-foreground">
          H{level}
        </span>
        <span className="h-0.5 flex-1 rounded-full bg-primary" />
        <span className="shrink-0 truncate text-[11px] text-muted-foreground">
          {parent ? `under ${parent}` : 'top level'}
        </span>
      </div>
    )

    return (
      <div className={cn('flex min-h-0 flex-col', className)}>
        {intro && (
          <div
            role={onActivateIntro ? 'button' : undefined}
            tabIndex={-1}
            onClick={onActivateIntro}
            title={onActivateIntro ? 'Go to the top of the document' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md border bg-muted/30',
              dense ? 'mb-1 px-1.5 py-1' : 'px-2.5 py-1.5',
              onActivateIntro && 'cursor-pointer hover:bg-muted/60'
            )}
          >
            <PinIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-muted-foreground',
                dense ? 'text-[11px]' : 'text-xs'
              )}
            >
              Intro — {intro.preview}
            </span>
            {showWords && (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {intro.words} w
              </span>
            )}
          </div>
        )}

        <div
          ref={listRef}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className="min-h-0 flex-1 overflow-y-auto py-0.5 outline-none"
        >
          {visible.map((index) => {
            const row = rows[index]
            const kids = descendantCount(rows, index)
            const isFolded = folded.has(row.id)
            const inDrag = dragIndex >= 0 && index >= dragIndex && index <= dragIndex + kids
            const imports = isFolded ? subtreePartials(rows, index) : row.partials
            return (
              <div key={row.id}>
                {drop && gap === index && dropMarker(drop.level, drop.parent)}
                <div
                  data-row-index={index}
                  draggable
                  onDragStart={onDragStart(index)}
                  onDragEnd={endDrag}
                  onClick={() => {
                    onSelChange(index)
                    listRef.current?.focus()
                  }}
                  style={{ marginLeft: (row.level - 1) * INDENT }}
                  onDoubleClick={() => onActivate(index)}
                  className={cn(
                    'group/row flex cursor-grab items-center rounded-md border border-transparent',
                    'select-none active:cursor-grabbing',
                    dense ? 'gap-1.5 px-1.5 py-1' : 'gap-2 px-2 py-1.5',
                    inDrag && 'opacity-40',
                    index === sel
                      ? 'border-primary/30 bg-accent'
                      : 'hover:border-border hover:bg-accent/50',
                    // The row the editor is parked in. A left rule rather than
                    // a fill, so it reads as a position marker and never
                    // competes with the selection.
                    index === currentIndex &&
                      index !== sel &&
                      'border-l-primary/70 bg-accent/30 [border-left-width:2px]'
                  )}
                >
                  <span
                    role={kids > 0 ? 'button' : undefined}
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelChange(index)
                      if (kids > 0) toggleFold(row.id)
                    }}
                    className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                  >
                    {kids > 0 && (
                      <ChevronDownIcon
                        className={cn(
                          'size-3.5 transition-transform duration-150',
                          isFolded && '-rotate-90'
                        )}
                      />
                    )}
                  </span>
                  <span className="shrink-0 rounded-sm border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">
                    H{row.level}
                  </span>
                  <span
                    className={cn('min-w-0 flex-1 truncate', dense ? 'text-[13px]' : 'text-sm')}
                  >
                    {row.title}
                  </span>
                  {imports.length > 0 && (
                    <span
                      title={`Imports ${imports.join(', ')}`}
                      className="flex shrink-0 items-center gap-1 rounded-sm border border-fuchsia-400/40 bg-fuchsia-400/10 px-1 font-mono text-[10px] text-fuchsia-600 dark:text-fuchsia-300"
                    >
                      <BracesIcon className="size-3" />
                      {imports.length > 1 ? imports.length : ''}
                    </span>
                  )}
                  {(showWords || (kids > 0 && isFolded)) && (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {showWords ? `${subtreeWords(rows, index).toLocaleString()} w` : ''}
                      {kids > 0 && isFolded ? `${showWords ? ' · ' : ''}${kids} inside` : ''}
                    </span>
                  )}
                  {/* Revealed on hover or when selected, so the row stays
                      quiet until you're actually pointing at it. */}
                  <span
                    role="button"
                    tabIndex={-1}
                    title={activateTitle}
                    aria-label="Go to heading"
                    onClick={(e) => {
                      e.stopPropagation()
                      onActivate(index)
                    }}
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-sm',
                      'text-muted-foreground hover:bg-background hover:text-foreground',
                      index === sel ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
                    )}
                  >
                    <CornerDownLeftIcon className="size-3.5" />
                  </span>
                </div>
              </div>
            )
          })}
          {drop && gap >= rows.length && dropMarker(drop.level, drop.parent)}
        </div>
      </div>
    )
  }
)

OutlineTree.displayName = 'OutlineTree'

/**
 * Split button: the main half toggles everything, the chevron opens depth
 * presets for documents too deep to read whole. Shared by both hosts, with
 * `extra` for host-specific items (the panel's side switch).
 */
export const OutlineFoldControls = ({
  rows,
  folded,
  onFoldedChange,
  onAfterAction,
  extra
}: {
  rows: OutlineRow[]
  folded: Set<number>
  onFoldedChange: (next: Set<number>) => void
  onAfterAction?: () => void
  extra?: React.ReactNode
}): React.JSX.Element => {
  const foldable = useMemo(() => foldableRows(rows), [rows])
  const allFolded = foldable.length > 0 && foldable.every((r) => folded.has(r.id))
  const deepest = rows.reduce((max, r) => Math.max(max, r.level), 1)
  const collapseAll = (): void => onFoldedChange(new Set(foldable.map((r) => r.id)))
  const expandAll = (): void => onFoldedChange(new Set())

  return (
    <div className="flex items-center overflow-hidden rounded-md border">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 rounded-none border-0"
        aria-label={allFolded ? 'Expand all' : 'Collapse all'}
        title={allFolded ? 'Expand all' : 'Collapse all'}
        onClick={() => {
          if (allFolded) expandAll()
          else collapseAll()
          onAfterAction?.()
        }}
      >
        {allFolded ? (
          <ChevronsUpDownIcon className="size-4" />
        ) : (
          <ChevronsDownUpIcon className="size-4" />
        )}
      </Button>
      <div className="h-4 w-px bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-none border-0"
            aria-label="Fold options"
          >
            <ChevronDownIcon className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={expandAll}>
            <ChevronsUpDownIcon className="size-3.5" />
            Expand all
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={collapseAll}>
            <ChevronsDownUpIcon className="size-3.5" />
            Collapse all
          </DropdownMenuItem>
          {deepest > 1 && <DropdownMenuSeparator />}
          {Array.from({ length: deepest - 1 }, (_, i) => i + 1).map((level) => (
            <DropdownMenuItem
              key={level}
              onSelect={() => onFoldedChange(foldsToLevel(rows, level))}
            >
              <span className="w-3.5" />
              {level === 1 ? 'Show H1 only' : `Show down to H${level}`}
            </DropdownMenuItem>
          ))}
          {extra}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Promote / demote the selected subtree. The only way to change a level —
 *  no key does it, by design. */
export const OutlineLevelControls = ({
  rows,
  sel,
  onEdit,
  onAfterAction
}: {
  rows: OutlineRow[]
  sel: number
  onEdit: (edit: NonNullable<OutlineEdit>) => void
  onAfterAction?: () => void
}): React.JSX.Element => {
  const shift = (dir: -1 | 1) => (): void => {
    const edit = shiftLevelEdit(rows, sel, dir)
    if (edit) onEdit(edit)
    onAfterAction?.()
  }
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Promote heading"
        title="Promote (make shallower)"
        onClick={shift(-1)}
      >
        <ChevronLeftIcon className={cn('size-4', !canShiftLevel(rows, sel, -1) && 'opacity-30')} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Demote heading"
        title="Demote (nest deeper)"
        onClick={shift(1)}
      >
        <ChevronRightIcon className={cn('size-4', !canShiftLevel(rows, sel, 1) && 'opacity-30')} />
      </Button>
    </>
  )
}

export default OutlineTree
