import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

const ChecklistShortcuts = Extension.create({
  name: 'checklistShortcuts',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-l': () => this.editor.chain().focus().toggleTaskList().run(),
      'Mod-Enter': () => {
        const { editor } = this
        const { from, to } = editor.state.selection
        const taskItems: Array<{ pos: number; node: typeof editor.state.doc }> = []

        editor.state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'taskItem') {
            taskItems.push({ pos, node })
          }
        })

        if (taskItems.length === 0) return false

        const allChecked = taskItems.every((item) => item.node.attrs.checked)
        const newChecked = !allChecked

        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            for (const { pos, node } of taskItems) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                checked: newChecked
              })
            }
            return true
          })
          .run()

        return true
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
}

const VisualEditor = ({ tabId, value, onChange }: Props): React.JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastScrollTop = useRef(0)
  const initialScroll = useRef(useWorkspace.getState().scrollPositions[tabId] ?? 0)
  const saveScrollPosition = useWorkspace((s) => s.saveScrollPosition)

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

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] }
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      ChecklistShortcuts,
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
    autofocus: 'end',
    content: value,
    onUpdate: ({ editor: e }) => {
      onChange(getMarkdown(e))
    },
    editorProps: {
      attributes: {
        class: cn('smarkup-editor focus:outline-none')
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
    <div ref={scrollRef} className="h-full overflow-auto">
      <EditorContent editor={editor} className="h-full" />
    </div>
  )
}

export default VisualEditor
