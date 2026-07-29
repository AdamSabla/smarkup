import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BracesIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CornerDownLeftIcon,
  PinIcon,
  Redo2Icon,
  Undo2Icon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  applyOutline,
  descendantCount,
  offsetOfSection,
  parseOutline,
  type Outline,
  type OutlineMove
} from '@/lib/outline'
import { revealHeading } from '@/lib/heading-jump'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')

/** Deepest heading the visual editor can render — demoting past it would
 *  serialize as literal `#####` text on the next round trip. */
const MAX_LEVEL = 4
const INDENT = 18

type Row = { id: number; level: number; title: string; words: number; partials: string[] }

/** One entry on the dialog's own undo stack. Folds aren't part of it —
 *  collapsing a row is a view action, not an edit. */
type Snapshot = { rows: Row[]; label: string }

const rowsOf = (outline: Outline): Row[] =>
  outline.sections.map((s) => ({
    id: s.id,
    level: s.level,
    title: s.title,
    words: s.words,
    partials: s.partials
  }))

/** Partials in a section and everything nested under it — a folded row still
 *  reports the imports hiding inside it. */
const subtreePartials = (rows: Row[], index: number): string[] => {
  const n = descendantCount(rows, index)
  const out: string[] = []
  for (let i = index; i <= index + n; i++) out.push(...rows[i].partials)
  return out
}

const same = (a: Row[], b: Row[]): boolean =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id && r.level === b[i].level)

/** Rows that aren't hidden inside a folded ancestor, as indices into `rows`. */
const visibleIndices = (rows: Row[], folded: Set<number>): number[] => {
  const out: number[] = []
  let hideBelow = Infinity
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].level > hideBelow) continue
    hideBelow = Infinity
    out.push(i)
    if (folded.has(rows[i].id) && descendantCount(rows, i) > 0) hideBelow = rows[i].level
  }
  return out
}

const subtreeWords = (rows: Row[], index: number): number => {
  const n = descendantCount(rows, index)
  let total = 0
  for (let i = index; i <= index + n; i++) total += rows[i].words
  return total
}

/**
 * Where a dragged block would land, and at what level.
 *
 * Drag decides position only: the block keeps its own level unless the
 * destination can't legally hold it (an H3 dropped where there's no H2 above
 * it), in which case it's clamped up to the deepest legal level. Nothing here
 * reads the pointer's x position — that ambiguity is what made dragging
 * fiddly, so level changes live on their own buttons instead.
 */
const planDrop = (
  rows: Row[],
  dragIndex: number,
  gap: number
): { insertAt: number; level: number; parent: string | null; rest: Row[]; span: number } => {
  const span = descendantCount(rows, dragIndex) + 1
  const rest = rows.slice(0, dragIndex).concat(rows.slice(dragIndex + span))
  const insertAt = gap > dragIndex ? gap - span : gap
  const prev = insertAt > 0 ? rest[insertAt - 1] : null
  const level = prev ? Math.min(rows[dragIndex].level, prev.level + 1) : 1
  let parent: string | null = null
  for (let i = insertAt - 1; i >= 0; i--) {
    if (rest[i].level < level) {
      parent = rest[i].title
      break
    }
  }
  return { insertAt, level, parent, rest, span }
}

const Kbd = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <kbd className="rounded border border-border bg-muted/50 px-1 font-mono text-[10px] text-muted-foreground">
    {children}
  </kbd>
)

const OutlineDialog = (): React.JSX.Element => {
  const outlineOpen = useWorkspace((s) => s.outlineOpen)
  const closeOutline = useWorkspace((s) => s.closeOutline)
  const updateActiveContent = useWorkspace((s) => s.updateActiveContent)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const tabs = useWorkspace((s) => s.tabs)
  const showToast = useWorkspace((s) => s.showToast)

  const tab = activeTabId ? tabs.find((t) => t.id === activeTabId) : undefined

  // Snapshot the document when the dialog opens. Editing the buffer behind an
  // open outline would invalidate every offset we're holding, so we work from
  // the snapshot and write back once, on apply.
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [base, setBase] = useState<Row[]>([])
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const [label, setLabel] = useState('')
  const [folded, setFolded] = useState<Set<number>>(new Set())
  const [sel, setSel] = useState(0)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  /** Row index waiting on the "apply and go?" confirmation, if any. */
  const [pendingJump, setPendingJump] = useState<number | null>(null)
  const [dragIndex, setDragIndex] = useState(-1)
  const [gap, setGap] = useState(-1)

  const outline = useMemo(() => parseOutline(source), [source])
  const listRef = useRef<HTMLDivElement>(null)
  const rectsRef = useRef<{ index: number; mid: number }[] | null>(null)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!outlineOpen) return
    const content = tab?.content ?? ''
    const initial = rowsOf(parseOutline(content))
    setSource(content)
    setRows(initial)
    setBase(initial)
    setPast([])
    setFuture([])
    setLabel('')
    setFolded(new Set())
    setSel(0)
    setConfirmDiscard(false)
    setPendingJump(null)
    setDragIndex(-1)
    setGap(-1)
    requestAnimationFrame(() => listRef.current?.focus())
    // `tab` is intentionally read once per open — see the snapshot note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineOpen])

  const dirty = rows.length > 0 && !same(rows, base)

  const commit = useCallback(
    (next: Row[], text: string, nextSel?: number) => {
      setPast((p) => [...p, { rows, label }])
      setFuture([])
      setRows(next)
      setLabel(text)
      if (nextSel != null) setSel(nextSel)
    },
    [rows, label]
  )

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p
      const last = p[p.length - 1]
      setFuture((f) => [...f, { rows, label }])
      setRows(last.rows)
      setLabel(last.label)
      return p.slice(0, -1)
    })
  }, [rows, label])

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f
      const next = f[f.length - 1]
      setPast((p) => [...p, { rows, label }])
      setRows(next.rows)
      setLabel(next.label)
      return f.slice(0, -1)
    })
  }, [rows, label])

  /** Move the selected section (and its subtree) past its previous or next
   *  sibling. Stops at the ends of the sibling group rather than promoting
   *  out of the parent — level changes stay explicit. */
  const moveSibling = useCallback(
    (dir: -1 | 1) => {
      if (sel < 0 || sel >= rows.length) return
      const level = rows[sel].level
      const span = descendantCount(rows, sel) + 1
      if (dir === -1) {
        let target = -1
        for (let i = sel - 1; i >= 0; i--) {
          if (rows[i].level < level) break
          if (rows[i].level === level) {
            target = i
            break
          }
        }
        if (target < 0) return
        const block = rows.slice(sel, sel + span)
        const rest = rows.slice(0, sel).concat(rows.slice(sel + span))
        const next = rest.slice(0, target).concat(block, rest.slice(target))
        commit(next, `Moved “${rows[sel].title}” up`, target)
      } else {
        const after = sel + span
        if (after >= rows.length || rows[after].level < level) return
        const tail = descendantCount(rows, after) + 1
        const block = rows.slice(sel, sel + span)
        const rest = rows.slice(0, sel).concat(rows.slice(sel + span))
        const next = rest.slice(0, sel + tail).concat(block, rest.slice(sel + tail))
        commit(next, `Moved “${rows[sel].title}” down`, sel + tail)
      }
    },
    [rows, sel, commit]
  )

  /** Promote or demote the selected subtree. Demote is refused when there's
   *  no shallower heading above it to nest under. */
  const shiftLevel = useCallback(
    (dir: -1 | 1) => {
      if (sel < 0 || sel >= rows.length) return
      const level = rows[sel].level
      if (dir === 1 && (level >= MAX_LEVEL || sel === 0 || rows[sel - 1].level < level)) return
      if (dir === -1 && level <= 1) return
      const span = descendantCount(rows, sel) + 1
      const next = rows.map((r, i) =>
        i >= sel && i < sel + span ? { ...r, level: r.level + dir } : r
      )
      commit(next, `“${rows[sel].title}” is now H${level + dir}`)
    },
    [rows, sel, commit]
  )

  const canDemote =
    sel < rows.length && rows[sel] != null && rows[sel].level < MAX_LEVEL && sel > 0
      ? rows[sel - 1].level >= rows[sel].level
      : false
  const canPromote = rows[sel] != null && rows[sel].level > 1

  const visible = useMemo(() => visibleIndices(rows, folded), [rows, folded])

  const toggleFold = useCallback((id: number) => {
    setFolded((f) => {
      const next = new Set(f)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** Rows that have something to fold — the only ones a fold set can contain. */
  const foldable = useMemo(() => rows.filter((_, i) => descendantCount(rows, i) > 0), [rows])
  const allFolded = foldable.length > 0 && foldable.every((r) => folded.has(r.id))
  const deepest = rows.reduce((max, r) => Math.max(max, r.level), 1)

  /**
   * Fold everything deeper than `level`, so the list bottoms out at that
   * heading level. Folding a row hides its children, so folding every row at
   * or below `level` is exactly "show H1…H{level}".
   */
  const showToLevel = useCallback(
    (level: number) => {
      setFolded(new Set(foldable.filter((r) => r.level >= level).map((r) => r.id)))
    },
    [foldable]
  )

  // A collapse can hide the selected row. Walking up to its nearest visible
  // ancestor keeps ↑↓ and the level buttons pointing at something on screen.
  useEffect(() => {
    if (visible.includes(sel) || rows.length === 0) return
    for (let i = sel - 1; i >= 0; i--) {
      if (visible.includes(i)) {
        setSel(i)
        return
      }
    }
    setSel(visible[0] ?? 0)
  }, [visible, sel, rows.length])

  // --- Drag ----------------------------------------------------------------
  // Row midpoints are measured once per drag and the dragover handler is
  // throttled to a frame, so pointer movement never triggers a re-render
  // unless the target gap actually changed.
  const onDragStart = (index: number) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    setDragIndex(index)
    setSel(index)
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
      setGap((g) => (g === target ? g : target))
    })
  }

  const endDrag = (): void => {
    setDragIndex(-1)
    setGap(-1)
    rectsRef.current = null
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    if (dragIndex < 0 || gap < 0) {
      endDrag()
      return
    }
    const moved = rows[dragIndex]
    const { insertAt, level, rest, span } = planDrop(rows, dragIndex, gap)
    const shift = level - moved.level
    const block = rows
      .slice(dragIndex, dragIndex + span)
      .map((r) => ({ ...r, level: Math.max(1, Math.min(MAX_LEVEL, r.level + shift)) }))
    const next = rest.slice(0, insertAt).concat(block, rest.slice(insertAt))
    endDrag()
    if (same(next, rows)) return
    commit(next, `Moved “${moved.title}”${shift ? ` · became H${level}` : ''}`, insertAt)
  }

  const drop = dragIndex >= 0 && gap >= 0 ? planDrop(rows, dragIndex, gap) : null

  // --- Apply / discard -----------------------------------------------------
  const apply = useCallback(() => {
    if (!dirty) {
      closeOutline()
      return
    }
    const moves: OutlineMove[] = rows.map((r) => ({ id: r.id, level: r.level }))
    updateActiveContent(applyOutline(source, moves))
    closeOutline()
    showToast('Outline applied — ⌘Z in the editor undoes it')
  }, [dirty, rows, source, updateActiveContent, closeOutline, showToast])

  const requestClose = useCallback(() => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    closeOutline()
  }, [dirty, confirmDiscard, closeOutline])

  /**
   * Close the dialog and reveal a heading in the editor.
   *
   * Pending changes are applied on the way out rather than discarded: you
   * arranged them deliberately, and applying is recoverable with one ⌘Z in the
   * editor while discarding is not. The section you clicked is the section you
   * land on either way — moving it changed where it sits, not what it is.
   */
  const goToHeading = useCallback(
    (index: number) => {
      const row = rows[index]
      if (!row) return
      const moves: OutlineMove[] = rows.map((r) => ({ id: r.id, level: r.level }))
      const offset = offsetOfSection(source, moves, row.id)
      if (dirty) {
        updateActiveContent(applyOutline(source, moves))
        showToast('Outline applied — ⌘Z in the editor undoes it')
      }
      closeOutline()
      revealHeading(index, offset)
    },
    [rows, source, dirty, updateActiveContent, closeOutline, showToast]
  )

  /** Jumping with unsaved moves is a decision, not a side effect — ask first. */
  const requestJump = useCallback(
    (index: number) => {
      if (dirty) setPendingJump(index)
      else goToHeading(index)
    },
    [dirty, goToHeading]
  )

  const revert = (): void => {
    if (!dirty) return
    commit(base, 'Reverted to the original order', 0)
  }

  // --- Keyboard ------------------------------------------------------------
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      apply()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      requestJump(sel)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (e.altKey) {
        moveSibling(e.key === 'ArrowUp' ? -1 : 1)
        return
      }
      const at = visible.indexOf(sel)
      const next = visible[at + (e.key === 'ArrowDown' ? 1 : -1)]
      if (next != null) setSel(next)
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

  const totalWords = outline.preambleWords + rows.reduce((sum, r) => sum + r.words, 0)
  const preview =
    outline.preamble
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ''

  return (
    <Dialog open={outlineOpen} onOpenChange={(open) => !open && requestClose()}>
      {/* Anchored near the top rather than centred: the list grows and shrinks
          as sections fold, and a centred dialog re-centres on every change, so
          the row you just clicked slides out from under the pointer. Same
          position the command palette uses. */}
      <DialogContent className="top-[10%] flex max-h-[80vh] translate-y-0 flex-col overflow-hidden sm:max-w-xl">
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <DialogTitle className="pr-0 text-base">Outline</DialogTitle>
            <DialogDescription className="text-xs">
              {tab ? `${tab.name.replace(/\.md$/i, '')} · ` : ''}
              {totalWords.toLocaleString()} words
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Split button: the main half toggles everything, the chevron
                opens depth presets for documents too deep to read whole. */}
            <div className="flex items-center overflow-hidden rounded-md border">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-none border-0"
                aria-label={allFolded ? 'Expand all' : 'Collapse all'}
                title={allFolded ? 'Expand all' : 'Collapse all'}
                onClick={() => {
                  if (allFolded) setFolded(new Set())
                  else setFolded(new Set(foldable.map((r) => r.id)))
                  listRef.current?.focus()
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
                  <DropdownMenuItem onSelect={() => setFolded(new Set())}>
                    <ChevronsUpDownIcon className="size-3.5" />
                    Expand all
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setFolded(new Set(foldable.map((r) => r.id)))}>
                    <ChevronsDownUpIcon className="size-3.5" />
                    Collapse all
                  </DropdownMenuItem>
                  {deepest > 1 && <DropdownMenuSeparator />}
                  {Array.from({ length: deepest - 1 }, (_, i) => i + 1).map((level) => (
                    <DropdownMenuItem key={level} onSelect={() => showToLevel(level)}>
                      <span className="w-3.5" />
                      {level === 1 ? 'Show H1 only' : `Show down to H${level}`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mx-1 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Promote heading"
              title="Promote (make shallower)"
              onClick={() => {
                shiftLevel(-1)
                listRef.current?.focus()
              }}
            >
              <ChevronLeftIcon className={cn('size-4', !canPromote && 'opacity-30')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Demote heading"
              title="Demote (nest deeper)"
              onClick={() => {
                shiftLevel(1)
                listRef.current?.focus()
              }}
            >
              <ChevronRightIcon className={cn('size-4', !canDemote && 'opacity-30')} />
            </Button>
            <div className="mx-1 h-4 w-px bg-border" />
            <Button variant="ghost" size="icon" className="size-7" aria-label="Undo" onClick={undo}>
              <Undo2Icon className={cn('size-4', past.length === 0 && 'opacity-30')} />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" aria-label="Redo" onClick={redo}>
              <Redo2Icon className={cn('size-4', future.length === 0 && 'opacity-30')} />
            </Button>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No headings in this document yet.
          </p>
        ) : (
          <>
            {preview && (
              <div className="flex shrink-0 items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
                <PinIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  Intro — {preview}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {outline.preambleWords} w
                </span>
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
                return (
                  <div key={row.id}>
                    {drop && gap === index && (
                      <div
                        className="flex items-center gap-1.5"
                        style={{ marginLeft: (drop.level - 1) * INDENT }}
                      >
                        <span className="rounded-sm bg-primary px-1 font-mono text-[10px] text-primary-foreground">
                          H{drop.level}
                        </span>
                        <span className="h-0.5 flex-1 rounded-full bg-primary" />
                        <span className="shrink-0 truncate text-[11px] text-muted-foreground">
                          {drop.parent ? `under ${drop.parent}` : 'top level'}
                        </span>
                      </div>
                    )}
                    <div
                      data-row-index={index}
                      draggable
                      onDragStart={onDragStart(index)}
                      onDragEnd={endDrag}
                      onClick={() => {
                        setSel(index)
                        listRef.current?.focus()
                      }}
                      style={{ marginLeft: (row.level - 1) * INDENT }}
                      onDoubleClick={() => requestJump(index)}
                      className={cn(
                        'group/row flex cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5',
                        'select-none active:cursor-grabbing',
                        inDrag && 'opacity-40',
                        index === sel
                          ? 'border-primary/30 bg-accent'
                          : 'hover:border-border hover:bg-accent/50'
                      )}
                    >
                      <span
                        role={kids > 0 ? 'button' : undefined}
                        tabIndex={-1}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSel(index)
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
                      <span className="min-w-0 flex-1 truncate text-sm">{row.title}</span>
                      {(() => {
                        const imports = isFolded ? subtreePartials(rows, index) : row.partials
                        if (imports.length === 0) return null
                        return (
                          <span
                            title={`Imports ${imports.join(', ')}`}
                            className="flex shrink-0 items-center gap-1 rounded-sm border border-fuchsia-400/40 bg-fuchsia-400/10 px-1 font-mono text-[10px] text-fuchsia-600 dark:text-fuchsia-300"
                          >
                            <BracesIcon className="size-3" />
                            {imports.length > 1 ? imports.length : ''}
                          </span>
                        )
                      })()}
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {subtreeWords(rows, index).toLocaleString()} w
                        {kids > 0 && isFolded ? ` · ${kids} inside` : ''}
                      </span>
                      {/* Revealed on hover or when selected, so the row stays
                          quiet until you're actually pointing at it. */}
                      <span
                        role="button"
                        tabIndex={-1}
                        title={dirty ? 'Apply changes and go to heading' : 'Go to heading'}
                        aria-label="Go to heading"
                        onClick={(e) => {
                          e.stopPropagation()
                          requestJump(index)
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
              {drop && gap >= rows.length && (
                <div
                  className="flex items-center gap-1.5"
                  style={{ marginLeft: (drop.level - 1) * INDENT }}
                >
                  <span className="rounded-sm bg-primary px-1 font-mono text-[10px] text-primary-foreground">
                    H{drop.level}
                  </span>
                  <span className="h-0.5 flex-1 rounded-full bg-primary" />
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {drop.parent ? `under ${drop.parent}` : 'top level'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                <Kbd>↑↓</Kbd> select
              </span>
              <span>
                <Kbd>⌥↑↓</Kbd> move
              </span>
              <span>
                <Kbd>←→</Kbd> fold
              </span>
              <span>
                <Kbd>{isMac ? '⌘Z' : 'Ctrl+Z'}</Kbd> undo
              </span>
              <span>
                <Kbd>↩</Kbd> go to heading
              </span>
              <span>
                <Kbd>{isMac ? '⌘↩' : 'Ctrl+Enter'}</Kbd> apply
              </span>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t pt-3">
              {pendingJump != null ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    Apply {past.length} {past.length === 1 ? 'change' : 'changes'} and go to “
                    {rows[pendingJump]?.title}”?
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setPendingJump(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => goToHeading(pendingJump)}>
                      Apply and go
                    </Button>
                  </div>
                </>
              ) : confirmDiscard ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    Discard {past.length} {past.length === 1 ? 'change' : 'changes'}?
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(false)}>
                      Keep editing
                    </Button>
                    <Button size="sm" variant="outline" onClick={closeOutline}>
                      Discard
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {label
                      ? `${label} · ${past.length} ${past.length === 1 ? 'change' : 'changes'}`
                      : 'No changes'}
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" onClick={revert}>
                      Revert
                    </Button>
                    <Button size="sm" variant="outline" onClick={apply}>
                      Apply
                    </Button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default OutlineDialog
