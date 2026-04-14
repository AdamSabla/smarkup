import { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'
import { FlatTaskItem } from '@/extensions/flat-task-item'
import { Tab } from '@/extensions/tab'
import { getActiveEditor, setActiveEditor } from '@/lib/active-editor'
import TableMenu from './TableMenu'

const getMarkdown = (editor: Editor): string => {
  const storage = editor.storage as unknown as { markdown: MarkdownStorage }
  return storage.markdown.getMarkdown()
}

type Props = {
  tabId: string
  value: string
  onChange: (markdown: string) => void
}

const VisualEditor = ({ tabId, value, onChange }: Props): React.JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const restoredRef = useRef(false)
  const saveScrollPosition = useWorkspace((s) => s.saveScrollPosition)
  const saveCursorPosition = useWorkspace((s) => s.saveCursorPosition)
  const lastEmittedMarkdown = useRef(value)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    // Persist scroll position to the store every 200ms so it's never stale.
    // Skip until restoration is done — otherwise the interval writes 0 to the
    // store before the editor has loaded and the restore effect has read it.
    let lastSaved = -1
    const interval = setInterval(() => {
      if (!restoredRef.current) return
      const top = el.scrollTop
      if (top !== lastSaved) {
        lastSaved = top
        saveScrollPosition(tabId, top)
      }
    }, 200)

    return () => {
      clearInterval(interval)
    }
  }, [tabId, saveScrollPosition])

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] }
      }),
      FlatTaskItem,
      Tab,
      // GFM-style tables. `resizable` gives users drag-handles on column borders.
      Table.configure({ resizable: true, HTMLAttributes: { class: 'smarkup-table' } }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: true,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: true
      })
    ],
    []
  )

  const editor = useEditor({
    extensions,
    autofocus: false,
    content: value,
    onUpdate: ({ editor: e }) => {
      const md = getMarkdown(e)
      lastEmittedMarkdown.current = md
      onChange(md)
    },
    editorProps: {
      attributes: {
        class: cn('smarkup-editor focus:outline-none')
      }
    }
  })

  // Save cursor position on unmount (tab switch)
  useEffect(() => {
    return () => {
      if (!editor) return
      const { anchor, head } = editor.state.selection
      saveCursorPosition(tabId, anchor, head)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, saveCursorPosition, editor])

  // Expose this editor as the active visual editor so the command palette and
  // other top-level UI can run commands against it.
  useEffect(() => {
    if (!editor) return
    setActiveEditor(editor)

    // Restore cursor position from a previous tab visit, or place at start.
    // Dispatch directly (without scrollIntoView) so it doesn't override scroll restore.
    const savedCursor = useWorkspace.getState().cursorPositions[tabId] ?? null
    if (savedCursor) {
      const docSize = editor.state.doc.content.size
      const anchor = Math.min(savedCursor.anchor, docSize)
      const head = Math.min(savedCursor.head, docSize)
      const sel = TextSelection.create(editor.state.doc, anchor, head)
      editor.view.dispatch(editor.state.tr.setSelection(sel))
    } else {
      const sel = TextSelection.create(editor.state.doc, 0)
      editor.view.dispatch(editor.state.tr.setSelection(sel))
    }

    // Restore scroll position, then focus. Focus must come AFTER scroll
    // to prevent scrollIntoView from overriding our position.
    // Use ResizeObserver to re-apply scrollTop until layout settles.
    const scrollEl = scrollRef.current
    if (!scrollEl) {
      restoredRef.current = true
      editor.view.dom.focus({ preventScroll: true })
      return () => {
        if (getActiveEditor() === editor) setActiveEditor(null)
      }
    }

    const saved = useWorkspace.getState().scrollPositions[tabId]
    const savedTop = typeof saved === 'number' ? saved : 0
    if (!savedTop) {
      restoredRef.current = true
      requestAnimationFrame(() => editor.view.dom.focus({ preventScroll: true }))
      return () => {
        if (getActiveEditor() === editor) setActiveEditor(null)
      }
    }

    let settled = false
    scrollEl.scrollTop = savedTop

    const settle = (): void => {
      settled = true
      restoredRef.current = true
      observer.disconnect()
      editor.view.dom.focus({ preventScroll: true })
    }

    const observer = new ResizeObserver(() => {
      if (settled) return
      scrollEl.scrollTop = savedTop
      if (scrollEl.scrollHeight - scrollEl.clientHeight >= savedTop) {
        settle()
      }
    })
    const contentEl = scrollEl.firstElementChild
    if (contentEl) observer.observe(contentEl)

    // Safety timeout — stop after 500ms and focus regardless
    const timeout = setTimeout(() => {
      if (!settled) {
        scrollEl.scrollTop = savedTop
        settle()
      }
    }, 500)

    return () => {
      observer.disconnect()
      clearTimeout(timeout)
      if (getActiveEditor() === editor) setActiveEditor(null)
    }
  }, [editor])

  // Reconcile external value changes (e.g. file reload from watcher or raw-edit)
  useEffect(() => {
    if (!editor) return
    if (value === lastEmittedMarkdown.current) return
    const current = getMarkdown(editor)
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false })
      lastEmittedMarkdown.current = value
    }
  }, [value, editor])

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto">
      <EditorContent editor={editor} className="h-full" />
      {editor && <TableMenu editor={editor} containerRef={scrollRef} />}
    </div>
  )
}

export default VisualEditor
