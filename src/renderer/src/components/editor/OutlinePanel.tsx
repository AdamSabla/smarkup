import { useCallback, useMemo, useRef, useState } from 'react'
import { PanelLeftIcon, PanelRightIcon, XIcon } from 'lucide-react'
import { undo as cmUndo } from '@codemirror/commands'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import OutlineTree, {
  OutlineFoldControls,
  OutlineLevelControls,
  type OutlineTreeHandle
} from '@/components/OutlineTree'
import { applyOutline, parseOutline, sectionOffsets } from '@/lib/outline'
import { rowsOf, type OutlineEdit, type OutlineRow } from '@/lib/outline-tree'
import { revealHeading } from '@/lib/heading-jump'
import { getActiveEditor } from '@/lib/active-editor'
import { getActiveRawEditor } from '@/lib/active-raw-editor'
import { useActiveHeading } from '@/hooks/useActiveHeading'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')

export const OUTLINE_PANEL_MIN = 170
export const OUTLINE_PANEL_MAX = 460

/** Below this the header label is more clutter than orientation. */
const LABEL_WIDTH = 250
/** Below this the per-section word counts crowd out the titles. */
const WORDS_WIDTH = 300

/**
 * Fold state has to outlive the ids it's expressed in. Row ids are positions
 * in the current parse, so every edit — and every heading the user types —
 * renumbers them; keying folds by what the heading *is* keeps a collapsed
 * section collapsed as it moves around.
 */
const foldKey = (row: OutlineRow): string => `${row.level}:${row.title}`

/** Undo the last edit in whichever editor is showing, so ⌘Z means the same
 *  thing with focus in the panel as it does with focus in the document. */
const undoInEditor = (): void => {
  const visual = getActiveEditor()
  if (visual && !visual.isDestroyed) {
    visual.commands.undo()
    return
  }
  const raw = getActiveRawEditor()
  if (raw) cmUndo(raw)
}

type OutlinePanelProps = {
  tabId: string | null
  paneId: string
}

/**
 * The outline docked beside the editor, inside the tab.
 *
 * Unlike the modal it holds nothing back: every move rewrites the buffer
 * immediately, as one editor undo step, so the document under it always
 * matches the list. It reads the tab's current content on every render, which
 * means headings you type show up here as you type them.
 */
const OutlinePanel = ({ tabId, paneId }: OutlinePanelProps): React.JSX.Element | null => {
  const visible = useWorkspace((s) => s.outlinePanelVisible)
  const side = useWorkspace((s) => s.outlinePanelSide)
  const width = useWorkspace((s) => s.outlinePanelWidth)
  const setWidth = useWorkspace((s) => s.setOutlinePanelWidth)
  const setSide = useWorkspace((s) => s.setOutlinePanelSide)
  const setVisible = useWorkspace((s) => s.setOutlinePanelVisible)
  const tabs = useWorkspace((s) => s.tabs)
  const updateTabContent = useWorkspace((s) => s.updateTabContent)
  const setActivePane = useWorkspace((s) => s.setActivePane)
  const activePaneId = useWorkspace((s) => s.activePaneId)

  const tab = tabId && !tabId.startsWith('diff:') ? tabs.find((t) => t.id === tabId) : undefined
  const content = tab?.content ?? ''

  const outline = useMemo(() => parseOutline(content), [content])
  const rows = useMemo(() => rowsOf(outline), [outline])
  const offsets = useMemo(() => sectionOffsets(outline), [outline])
  const intro = useMemo(() => {
    const preview =
      outline.preamble
        .split('\n')
        .find((l) => l.trim().length > 0)
        ?.trim() ?? ''
    return preview ? { preview, words: outline.preambleWords } : null
  }, [outline])

  const [foldedKeys, setFoldedKeys] = useState<ReadonlySet<string>>(new Set())
  const [sel, setSel] = useState(0)
  const treeRef = useRef<OutlineTreeHandle>(null)

  const isPaneActive = activePaneId === paneId
  const currentIndex = useActiveHeading(offsets, visible && isPaneActive && !!tab)

  const folded = useMemo(
    () => new Set(rows.filter((r) => foldedKeys.has(foldKey(r))).map((r) => r.id)),
    [rows, foldedKeys]
  )

  const onFoldedChange = useCallback(
    (ids: Set<number>) => {
      setFoldedKeys(new Set(rows.filter((r) => ids.has(r.id)).map(foldKey)))
    },
    [rows]
  )

  /** Write the edit straight through to the buffer. */
  const onEdit = useCallback(
    (edit: NonNullable<OutlineEdit>) => {
      if (!tab) return
      const moves = edit.rows.map((r) => ({ id: r.id, level: r.level }))
      updateTabContent(tab.id, applyOutline(content, moves))
      setSel(edit.sel)
    },
    [tab, content, updateTabContent]
  )

  const onActivate = useCallback(
    (index: number) => {
      if (!isPaneActive) setActivePane(paneId)
      setSel(index)
      revealHeading(index, offsets[index] ?? 0)
    },
    [isPaneActive, setActivePane, paneId, offsets]
  )

  /** The intro row has no heading to reveal — it's the top of the document. */
  const goToTop = useCallback(() => {
    if (!isPaneActive) setActivePane(paneId)
    requestAnimationFrame(() => {
      const visual = getActiveEditor()
      if (visual && !visual.isDestroyed) {
        visual.chain().focus().setTextSelection(1).scrollIntoView().run()
        return
      }
      const rawView = getActiveRawEditor()
      if (rawView) {
        rawView.focus()
        rawView.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })
      }
    })
  }, [isPaneActive, setActivePane, paneId])

  // --- Resize --------------------------------------------------------------
  // The handle sits on the editor-facing edge and stays invisible until it's
  // wanted: there's no divider line, just a hairline that fades in under the
  // pointer, per "make it minimal".
  const dragRef = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: React.PointerEvent): void => {
    e.preventDefault()
    dragRef.current = { x: e.clientX, width }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const start = dragRef.current
    if (!start) return
    // Dragging the handle away from the panel's own edge widens it, whichever
    // side it's docked on.
    const delta = side === 'right' ? start.x - e.clientX : e.clientX - start.x
    setWidth(Math.min(OUTLINE_PANEL_MAX, Math.max(OUTLINE_PANEL_MIN, start.width + delta)))
  }

  const onPointerUp = (): void => {
    dragRef.current = null
    setDragging(false)
  }

  if (!visible || !tab) return null

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undoInEditor()
    }
  }

  return (
    <aside
      style={{ width }}
      onKeyDown={onKeyDown}
      className="relative flex h-full shrink-0 flex-col overflow-hidden"
    >
      <div className="flex h-8 shrink-0 items-center gap-1 px-1.5">
        {width >= LABEL_WIDTH && (
          <span className="min-w-0 flex-1 truncate px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Outline
          </span>
        )}
        <div className={cn('flex items-center gap-0.5', width < LABEL_WIDTH && 'flex-1')}>
          <OutlineLevelControls
            rows={rows}
            sel={sel}
            onEdit={onEdit}
            onAfterAction={() => treeRef.current?.focus()}
          />
        </div>
        <OutlineFoldControls
          rows={rows}
          folded={folded}
          onFoldedChange={onFoldedChange}
          onAfterAction={() => treeRef.current?.focus()}
          extra={
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void setSide(side === 'right' ? 'left' : 'right')}>
                {side === 'right' ? (
                  <PanelLeftIcon className="size-3.5" />
                ) : (
                  <PanelRightIcon className="size-3.5" />
                )}
                Move to the {side === 'right' ? 'left' : 'right'}
              </DropdownMenuItem>
            </>
          }
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Close outline panel"
          title="Close outline panel"
          onClick={() => void setVisible(false)}
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">No headings yet.</p>
      ) : (
        <OutlineTree
          ref={treeRef}
          dense
          rows={rows}
          sel={sel}
          onSelChange={setSel}
          folded={folded}
          onFoldedChange={onFoldedChange}
          onEdit={onEdit}
          onActivate={onActivate}
          currentIndex={currentIndex}
          intro={intro}
          onActivateIntro={goToTop}
          // Word counts are the first thing to go when the panel is narrow —
          // at this width they'd be eating the titles you navigate by.
          showWords={width >= WORDS_WIDTH}
          className="flex-1 px-1.5 pb-1.5"
        />
      )}

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'absolute inset-y-0 z-10 w-1.5 cursor-col-resize',
          side === 'right' ? 'left-0' : 'right-0',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2',
          'after:transition-colors hover:after:bg-border',
          dragging && 'after:bg-ring/60 hover:after:bg-ring/60'
        )}
      />
    </aside>
  )
}

export default OutlinePanel
