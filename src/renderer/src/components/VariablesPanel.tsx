import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { resolveEditorMode, useWorkspace } from '@/store/workspace'
import { useActiveEditor } from '@/lib/active-editor'
import { useActiveRawEditor } from '@/lib/active-raw-editor'
import {
  extractVariables,
  jumpToRawRange,
  jumpToVisualOccurrence,
  snippetAround,
  type VariableGroup
} from '@/lib/variables'

/**
 * A compact bottom-docked panel that lists every `{{variable}}` in the
 * active tab as a chip. Each chip shows `{{name}}` followed by a
 * `position/total` badge. Clicking cycles forward; shift+click cycles
 * backward. Chips are sorted alphabetically so the panel layout stays
 * stable as the user edits.
 *
 * Works with both the raw (CodeMirror) and visual (Tiptap) editors —
 * whichever is active for the current pane is driven.
 */
const VariablesPanel = (): React.JSX.Element | null => {
  const visible = useWorkspace((s) => s.variablesPanelVisible)
  const toggle = useWorkspace((s) => s.toggleVariablesPanel)
  const tabs = useWorkspace((s) => s.tabs)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const editorMode = useWorkspace((s) => s.editorMode)
  const fileEditorModes = useWorkspace((s) => s.fileEditorModes)
  const rawView = useActiveRawEditor()
  const visualEditor = useActiveEditor()

  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : undefined
  const content = activeTab?.content ?? ''
  const mode = resolveEditorMode(activeTab?.path, fileEditorModes, editorMode)

  // Sort alphabetically so chip order is stable across edits.
  const groups = useMemo(() => {
    const extracted = extractVariables(content)
    return [...extracted].sort((a, b) => a.name.localeCompare(b.name))
  }, [content])

  // Per-variable current occurrence index. Keyed by variable name so the
  // cursor sticks to a variable across content edits (unless the whole
  // group vanishes, in which case the entry is GC'd below).
  const [cursors, setCursors] = useState<Record<string, number>>({})

  // Drop cursor entries for variables that no longer exist — keeps the map
  // from growing unboundedly as the user renames placeholders. Derived-
  // during-render per React's "derive state from props" pattern; the
  // setState call is a no-op when nothing changed (object identity match),
  // so we don't trigger an extra render.
  const prunedCursors = useMemo(() => {
    const names = new Set(groups.map((g) => g.name))
    let changed = false
    const next: Record<string, number> = {}
    for (const [k, v] of Object.entries(cursors)) {
      if (names.has(k)) next[k] = v
      else changed = true
    }
    return changed ? next : cursors
  }, [cursors, groups])
  if (prunedCursors !== cursors) setCursors(prunedCursors)

  const jumpTo = useCallback(
    (group: VariableGroup, index: number): void => {
      const occ = group.occurrences[index]
      if (!occ) return
      if (mode === 'raw') {
        if (rawView) jumpToRawRange(rawView, occ.from, occ.to)
      } else if (visualEditor) {
        // Visual-editor occurrences and source occurrences go in the same
        // order, so the group-local index maps 1:1.
        jumpToVisualOccurrence(visualEditor, occ.raw, index)
      }
    },
    [mode, rawView, visualEditor]
  )

  const step = useCallback(
    (group: VariableGroup, direction: 1 | -1): void => {
      if (group.occurrences.length === 0) return
      setCursors((prev) => {
        const total = group.occurrences.length
        const current = prev[group.name]
        // First activation: forward lands on 0, backward lands on last.
        const nextIdx =
          current === undefined
            ? direction === 1
              ? 0
              : total - 1
            : (current + direction + total) % total
        jumpTo(group, nextIdx)
        return { ...prev, [group.name]: nextIdx }
      })
    },
    [jumpTo]
  )

  // Focus the first chip on open for keyboard users (⌘⇧V → Tab through).
  const prevVisible = useRef(visible)
  const firstChipRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (visible && !prevVisible.current) {
      firstChipRef.current?.focus()
    }
    prevVisible.current = visible
  }, [visible])

  if (!visible) return null

  return (
    <div
      className="flex max-h-48 shrink-0 flex-col border-t bg-background"
      aria-label="Variables panel"
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Variables {groups.length > 0 ? `(${groups.length})` : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => void toggle()}
          aria-label="Hide variables panel"
          title="Hide variables panel"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        {groups.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            No {'{{variables}}'} in this document.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 p-2">
            {groups.map((group, i) => {
              const total = group.occurrences.length
              const idx = cursors[group.name]
              const position = idx === undefined ? 1 : idx + 1
              const preview =
                idx === undefined
                  ? snippetAround(content, group.occurrences[0].from, group.occurrences[0].to)
                  : snippetAround(content, group.occurrences[idx].from, group.occurrences[idx].to)
              return (
                <Tooltip key={group.name}>
                  <TooltipTrigger asChild>
                    <button
                      ref={i === 0 ? firstChipRef : undefined}
                      type="button"
                      onClick={(e) => step(group, e.shiftKey ? -1 : 1)}
                      className="group inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pl-2 pr-1 text-xs font-mono text-fuchsia-400 transition-colors hover:bg-accent hover:border-ring/40 focus:outline-none focus:ring-1 focus:ring-ring"
                      title={`Click: next • Shift+click: previous`}
                      aria-label={`Jump to {{${group.name}}} — ${position} of ${total}`}
                    >
                      <span className="truncate">
                        {'{{'}
                        {group.name}
                        {'}}'}
                      </span>
                      <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-background px-1.5 py-px text-[10px] font-sans tabular-nums text-muted-foreground">
                        {position}/{total}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm">
                    <span className="font-mono text-[11px]">{preview}</span>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default VariablesPanel
