import { useEffect } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { cn } from '@/lib/utils'

const getMarkdown = (editor: Editor): string => {
  const storage = editor.storage as unknown as { markdown: MarkdownStorage }
  return storage.markdown.getMarkdown()
}

type Props = {
  value: string
  onChange: (markdown: string) => void
}

const VisualEditor = ({ value, onChange }: Props): React.JSX.Element => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] }
      }),
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
    content: value,
    onUpdate: ({ editor: e }) => {
      onChange(getMarkdown(e))
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-neutral dark:prose-invert max-w-none',
          'focus:outline-none min-h-full px-12 py-10'
        )
      }
    }
  })

  // Reconcile external value changes (e.g. switching tabs or raw-edit changes)
  useEffect(() => {
    if (!editor) return
    const current = getMarkdown(editor)
    if (current !== value) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [value, editor])

  return (
    <div className="h-full overflow-auto">
      <EditorContent editor={editor} className="h-full" />
    </div>
  )
}

export default VisualEditor
