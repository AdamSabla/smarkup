import { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Text } from '@tiptap/extension-text'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { cn } from '@/lib/utils'
import { FlatTaskItem } from '@/extensions/flat-task-item'
import { Tab } from '@/extensions/tab'
import { HtmlPaste } from '@/extensions/html-paste'
import { getActiveEditor, setActiveEditor } from '@/lib/active-editor'
import { serializeSliceToText } from '@/lib/serialize-clipboard-text'
import TableMenu from './TableMenu'

// tiptap-markdown's default text serializer always HTML-escapes `<` and `>`,
// so any literal angle bracket (e.g. pasted HTML, "1 < 2") becomes `&lt;`/`&gt;`
// in the saved markdown. Override it to leave text alone — markdown escaping
// for `*`, `_`, `[` etc. is already handled by prosemirror-markdown's state.text.
const PlainText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: { text: (s: string) => void }, node: { text?: string }) {
          state.text(node.text ?? '')
        },
        parse: {}
      }
    }
  }
})

const getMarkdown = (editor: Editor): string => {
  const storage = editor.storage as unknown as { markdown: MarkdownStorage }
  return storage.markdown.getMarkdown()
}

type Props = {
  tabId: string
  value: string
  onChange: (markdown: string) => void
  isActive: boolean
}

const VisualEditor = ({ tabId: _tabId, value, onChange, isActive }: Props): React.JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastEmittedMarkdown = useRef(value)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        // Replaced by PlainText below — see comment on PlainText for why.
        text: false
      }),
      PlainText,
      FlatTaskItem,
      Tab,
      // GFM-style tables. `resizable` gives users drag-handles on column borders.
      Table.configure({ resizable: true, HTMLAttributes: { class: 'smarkup-table' } }),
      TableRow,
      TableHeader,
      TableCell,
      HtmlPaste,
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: true,
        breaks: false,
        transformPastedText: true,
        // Keep the clipboard's text/plain slot as visible text (no markdown
        // syntax), so pasting into plain inputs like the rename field yields
        // "hello" instead of "**hello**". Rich targets still read text/html.
        transformCopiedText: false
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
      onChangeRef.current(md)
    },
    editorProps: {
      attributes: {
        class: cn('smarkup-editor focus:outline-none')
      },
      // Override ProseMirror's default text serializer (which uses "\n\n"
      // between blocks and stacks blank lines around empty paragraphs) with
      // a single-newline-per-block walker that also adds bullet/task
      // prefixes. See lib/serialize-clipboard-text.ts for the why.
      clipboardTextSerializer: (slice) => serializeSliceToText(slice)
    }
  })

  // Set/unset this as the active editor and focus when tab becomes active.
  // The editor stays mounted (DOM + scroll preserved) so no restore is needed.
  useEffect(() => {
    if (!editor) return
    if (isActive) {
      setActiveEditor(editor)
      editor.view.dom.focus({ preventScroll: true })
    }
    return () => {
      if (getActiveEditor() === editor) setActiveEditor(null)
    }
  }, [editor, isActive])

  // Reconcile external value changes (e.g. file reload from watcher)
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
