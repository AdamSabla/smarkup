import { useCallback, useMemo, useState } from 'react'
import { resolveEditorMode, useWorkspace } from '@/store/workspace'
import { useActiveEditor } from '@/lib/active-editor'
import { useActiveRawEditor } from '@/lib/active-raw-editor'
import { extractTodos, jumpToRawTodo, jumpToVisualTodo } from '@/lib/todos'

type Props = {
  tabId: string | null
  /** Hide the chip when this pane isn't the active pane — only the focused
   *  pane should expose the cycle interaction (jumping uses the globally
   *  active editor refs, which only reflect the active pane). */
  isActive: boolean
}

/**
 * A small badge floated over the editor's bottom-right corner that surfaces
 * `TODO` markers in the document. Click cycles forward through occurrences;
 * shift+click cycles backward — same chord as the variables panel chips so
 * the interaction is consistent. The chip itself is intentionally muted (the
 * TODO marks in the document do the loud-yellow attention-grabbing); this
 * is a subtle navigation affordance, not a second alarm.
 */
const TodoChip = ({ tabId, isActive }: Props): React.JSX.Element | null => {
  const tabs = useWorkspace((s) => s.tabs)
  const editorMode = useWorkspace((s) => s.editorMode)
  const fileEditorModes = useWorkspace((s) => s.fileEditorModes)
  const rawView = useActiveRawEditor()
  const visualEditor = useActiveEditor()

  const tab = tabId ? tabs.find((t) => t.id === tabId) : undefined
  const content = tab?.content ?? ''
  const mode = resolveEditorMode(tab?.path, fileEditorModes, editorMode)

  const todos = useMemo(() => extractTodos(content), [content])

  // Per-tab cursor — undefined means "first activation". Reset whenever the
  // todo list shrinks past the cursor so we don't point at a stale slot.
  const [cursor, setCursor] = useState<number | undefined>(undefined)
  const safeCursor = cursor !== undefined && cursor < todos.length ? cursor : undefined

  const cycle = useCallback(
    (direction: 1 | -1): void => {
      if (todos.length === 0) return
      const total = todos.length
      const nextIdx =
        safeCursor === undefined
          ? direction === 1
            ? 0
            : total - 1
          : (safeCursor + direction + total) % total
      const occ = todos[nextIdx]
      if (mode === 'raw') {
        if (rawView) jumpToRawTodo(rawView, occ.from, occ.to)
      } else if (visualEditor) {
        jumpToVisualTodo(visualEditor, nextIdx)
      }
      setCursor(nextIdx)
    },
    [todos, mode, rawView, visualEditor, safeCursor]
  )

  if (!tab || todos.length === 0 || !isActive) return null

  const total = todos.length
  const position = safeCursor === undefined ? 1 : safeCursor + 1

  return (
    <button
      type="button"
      onClick={(e) => cycle(e.shiftKey ? -1 : 1)}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-background/90 py-0.5 pl-2 pr-1 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent hover:border-ring/40 focus:outline-none focus:ring-1 focus:ring-ring"
      title="Click: next TODO • Shift+click: previous"
      aria-label={`Jump to next TODO — ${position} of ${total}`}
    >
      <span>TODO</span>
      <span className="ml-0.5 inline-flex items-center justify-center rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
        {position}/{total}
      </span>
    </button>
  )
}

export default TodoChip
