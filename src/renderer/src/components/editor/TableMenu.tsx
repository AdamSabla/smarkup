import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  ArrowDownToLineIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ArrowUpToLineIcon,
  HeadingIcon,
  Trash2Icon
} from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  editor: Editor
  /**
   * The scroll container that wraps the editor content. The menu is positioned
   * relative to this element so it can be sticky against the editor viewport.
   */
  containerRef: React.RefObject<HTMLDivElement | null>
}

type Rect = { top: number; left: number; width: number } | null

/**
 * Find the currently active <table> DOM element based on the editor selection.
 */
const findActiveTable = (editor: Editor): HTMLTableElement | null => {
  if (!editor.isActive('table')) return null
  const { from } = editor.state.selection
  let dom: Node | null
  try {
    dom = editor.view.domAtPos(from).node
  } catch {
    return null
  }
  let el: HTMLElement | null = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null)
  while (el && el.tagName !== 'TABLE') {
    el = el.parentElement
  }
  return el as HTMLTableElement | null
}

/**
 * Floating toolbar with table-editing buttons. Appears just above the current
 * table whenever the cursor is inside one. Lives inside the editor's scroll
 * container so it scrolls with the document.
 */
const TableMenu = ({ editor, containerRef }: Props): React.JSX.Element | null => {
  const [rect, setRect] = useState<Rect>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Recompute position whenever selection changes or the editor scrolls.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const update = (): void => {
      const table = findActiveTable(editor)
      if (!table) {
        setRect(null)
        return
      }
      const cRect = container.getBoundingClientRect()
      const tRect = table.getBoundingClientRect()
      setRect({
        top: tRect.top - cRect.top + container.scrollTop,
        left: tRect.left - cRect.left + container.scrollLeft,
        width: tRect.width
      })
    }

    update()

    const onSelection = (): void => update()
    editor.on('selectionUpdate', onSelection)
    editor.on('transaction', onSelection)

    container.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)

    return () => {
      editor.off('selectionUpdate', onSelection)
      editor.off('transaction', onSelection)
      container.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [editor, containerRef])

  // After layout, nudge the menu up by its own height so it sits above the table.
  const [offsetY, setOffsetY] = useState(0)
  useLayoutEffect(() => {
    if (!rect || !menuRef.current) return
    setOffsetY(menuRef.current.offsetHeight + 6)
  }, [rect])

  if (!rect) return null

  const can = editor.can()
  const btn = (
    title: string,
    onClick: () => void,
    icon: React.ReactNode,
    opts: { danger?: boolean; disabled?: boolean } = {}
  ): React.JSX.Element => (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={opts.disabled}
      onMouseDown={(e) => {
        // Prevent the editor from losing selection before the command runs.
        e.preventDefault()
      }}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
        'hover:bg-accent hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-40',
        opts.danger && 'hover:bg-destructive/10 hover:text-destructive'
      )}
    >
      {icon}
    </button>
  )

  return (
    <div
      ref={menuRef}
      contentEditable={false}
      style={{
        position: 'absolute',
        top: rect.top - offsetY,
        left: rect.left,
        maxWidth: rect.width
      }}
      className="z-20 flex items-center gap-0.5 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      // Stop clicks inside the menu from bubbling to the editor.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {btn(
        'Add row above',
        () => editor.chain().focus().addRowBefore().run(),
        <ArrowUpToLineIcon className="size-3.5" />,
        { disabled: !can.addRowBefore() }
      )}
      {btn(
        'Add row below',
        () => editor.chain().focus().addRowAfter().run(),
        <ArrowDownToLineIcon className="size-3.5" />,
        { disabled: !can.addRowAfter() }
      )}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      {btn(
        'Add column left',
        () => editor.chain().focus().addColumnBefore().run(),
        <ArrowLeftToLineIcon className="size-3.5" />,
        { disabled: !can.addColumnBefore() }
      )}
      {btn(
        'Add column right',
        () => editor.chain().focus().addColumnAfter().run(),
        <ArrowRightToLineIcon className="size-3.5" />,
        { disabled: !can.addColumnAfter() }
      )}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      {btn(
        'Toggle header row',
        () => editor.chain().focus().toggleHeaderRow().run(),
        <HeadingIcon className="size-3.5" />,
        { disabled: !can.toggleHeaderRow() }
      )}
      <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
      {btn(
        'Delete row',
        () => editor.chain().focus().deleteRow().run(),
        <span className="text-[10px] font-semibold">−R</span>,
        { danger: true, disabled: !can.deleteRow() }
      )}
      {btn(
        'Delete column',
        () => editor.chain().focus().deleteColumn().run(),
        <span className="text-[10px] font-semibold">−C</span>,
        { danger: true, disabled: !can.deleteColumn() }
      )}
      {btn(
        'Delete table',
        () => editor.chain().focus().deleteTable().run(),
        <Trash2Icon className="size-3.5" />,
        { danger: true, disabled: !can.deleteTable() }
      )}
    </div>
  )
}

export default TableMenu
