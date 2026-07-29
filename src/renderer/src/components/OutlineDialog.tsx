import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanelRightIcon, Redo2Icon, Undo2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import OutlineTree, {
  OutlineFoldControls,
  OutlineLevelControls,
  type OutlineTreeHandle
} from '@/components/OutlineTree'
import {
  applyOutline,
  offsetOfSection,
  parseOutline,
  type Outline,
  type OutlineMove
} from '@/lib/outline'
import { rowsOf, sameRows, type OutlineEdit, type OutlineRow } from '@/lib/outline-tree'
import { revealHeading } from '@/lib/heading-jump'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')

/** One entry on the dialog's own undo stack. Folds aren't part of it —
 *  collapsing a row is a view action, not an edit. */
type Snapshot = { rows: OutlineRow[]; label: string }

const introOf = (outline: Outline): { preview: string; words: number } | null => {
  const preview =
    outline.preamble
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? ''
  return preview ? { preview, words: outline.preambleWords } : null
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
  const setOutlinePanelVisible = useWorkspace((s) => s.setOutlinePanelVisible)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const tabs = useWorkspace((s) => s.tabs)
  const showToast = useWorkspace((s) => s.showToast)

  const tab = activeTabId ? tabs.find((t) => t.id === activeTabId) : undefined

  // Snapshot the document when the dialog opens. Editing the buffer behind an
  // open outline would invalidate every offset we're holding, so we work from
  // the snapshot and write back once, on apply.
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<OutlineRow[]>([])
  const [base, setBase] = useState<OutlineRow[]>([])
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const [label, setLabel] = useState('')
  const [folded, setFolded] = useState<Set<number>>(new Set())
  const [sel, setSel] = useState(0)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  /** Row index waiting on the "apply and go?" confirmation, if any. */
  const [pendingJump, setPendingJump] = useState<number | null>(null)

  const outline = useMemo(() => parseOutline(source), [source])
  const treeRef = useRef<OutlineTreeHandle>(null)
  const focusTree = useCallback(() => treeRef.current?.focus(), [])

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
    // `tab` is intentionally read once per open — see the snapshot note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlineOpen])

  const dirty = rows.length > 0 && !sameRows(rows, base)

  const commit = useCallback(
    (next: OutlineRow[], text: string, nextSel?: number) => {
      setPast((p) => [...p, { rows, label }])
      setFuture([])
      setRows(next)
      setLabel(text)
      if (nextSel != null) setSel(nextSel)
    },
    [rows, label]
  )

  const applyEdit = useCallback(
    (edit: NonNullable<OutlineEdit>) => commit(edit.rows, edit.label, edit.sel),
    [commit]
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

  const moves = useMemo<OutlineMove[]>(
    () => rows.map((r) => ({ id: r.id, level: r.level })),
    [rows]
  )

  // --- Apply / discard -----------------------------------------------------
  const apply = useCallback(() => {
    if (!dirty) {
      closeOutline()
      return
    }
    updateActiveContent(applyOutline(source, moves))
    closeOutline()
    showToast('Outline applied — ⌘Z in the editor undoes it')
  }, [dirty, moves, source, updateActiveContent, closeOutline, showToast])

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
      const offset = offsetOfSection(source, moves, row.id)
      if (dirty) {
        updateActiveContent(applyOutline(source, moves))
        showToast('Outline applied — ⌘Z in the editor undoes it')
      }
      closeOutline()
      revealHeading(index, offset)
    },
    [rows, moves, source, dirty, updateActiveContent, closeOutline, showToast]
  )

  /** Jumping with unsaved moves is a decision, not a side effect — ask first. */
  const requestJump = useCallback(
    (index: number) => {
      if (dirty) setPendingJump(index)
      else goToHeading(index)
    },
    [dirty, goToHeading]
  )

  /**
   * Hand the outline over to the docked panel. Pending moves are applied on
   * the way out for the same reason `goToHeading` applies them: the panel
   * edits live, so there'd be nowhere to keep a staged change once it opens.
   */
  const dock = useCallback(() => {
    if (dirty) {
      updateActiveContent(applyOutline(source, moves))
      showToast('Outline applied — ⌘Z in the editor undoes it')
    }
    closeOutline()
    void setOutlinePanelVisible(true)
  }, [dirty, moves, source, updateActiveContent, closeOutline, setOutlinePanelVisible, showToast])

  const revert = (): void => {
    if (!dirty) return
    commit(base, 'Reverted to the original order', 0)
  }

  // Keys the tree doesn't own. It prevents its own (↑↓, ⌥↑↓, ←→, ↩) and lets
  // the rest bubble up to here.
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
    }
  }

  const totalWords = outline.preambleWords + rows.reduce((sum, r) => sum + r.words, 0)

  return (
    <Dialog open={outlineOpen} onOpenChange={(open) => !open && requestClose()}>
      {/* Anchored near the top rather than centred: the list grows and shrinks
          as sections fold, and a centred dialog re-centres on every change, so
          the row you just clicked slides out from under the pointer. Same
          position the command palette uses. */}
      <DialogContent
        // Radix focuses the first focusable child on open, which would put the
        // arrow keys on the collapse button instead of the list. The list is
        // what the whole dialog is for, so claim focus for it explicitly.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          focusTree()
        }}
        onKeyDown={onKeyDown}
        className="top-[10%] flex max-h-[80vh] translate-y-0 flex-col overflow-hidden sm:max-w-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <DialogTitle className="pr-0 text-base">Outline</DialogTitle>
            <DialogDescription className="text-xs">
              {tab ? `${tab.name.replace(/\.md$/i, '')} · ` : ''}
              {totalWords.toLocaleString()} words
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Dock outline beside the editor"
              title="Keep the outline open beside the editor"
              onClick={dock}
            >
              <PanelRightIcon className="size-4" />
            </Button>
            <div className="mx-1 h-4 w-px bg-border" />
            <OutlineFoldControls
              rows={rows}
              folded={folded}
              onFoldedChange={setFolded}
              onAfterAction={focusTree}
            />
            <div className="mx-1 h-4 w-px bg-border" />
            <OutlineLevelControls
              rows={rows}
              sel={sel}
              onEdit={applyEdit}
              onAfterAction={focusTree}
            />
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
            <OutlineTree
              ref={treeRef}
              rows={rows}
              sel={sel}
              onSelChange={setSel}
              folded={folded}
              onFoldedChange={setFolded}
              onEdit={applyEdit}
              onActivate={requestJump}
              activateTitle={dirty ? 'Apply changes and go to heading' : 'Go to heading'}
              intro={introOf(outline)}
              className="flex-1 gap-2"
            />

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
