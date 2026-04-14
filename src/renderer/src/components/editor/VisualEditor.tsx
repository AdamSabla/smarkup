import { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
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
  const lastScrollTop = useRef(0)
  const initialScroll = useRef(useWorkspace.getState().scrollPositions[tabId] ?? 0)
  const saveScrollPosition = useWorkspace((s) => s.saveScrollPosition)
  const lastEmittedMarkdown = useRef(value)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    if (initialScroll.current) {
      requestAnimationFrame(() => {
        el.scrollTop = initialScroll.current
        lastScrollTop.current = initialScroll.current
      })
    }

    const onScroll = (): void => {
      lastScrollTop.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      el.removeEventListener('scroll', onScroll)
      saveScrollPosition(tabId, lastScrollTop.current)
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
    autofocus: 'end',
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

  // Expose this editor as the active visual editor so the command palette and
  // other top-level UI can run commands against it.
  useEffect(() => {
    if (!editor) return
    setActiveEditor(editor)
    return () => {
      // Only clear if we're still the active one — avoids races when a new
      // VisualEditor mounts (different tab) before this one unmounts.
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
