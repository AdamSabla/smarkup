import { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'
import { FlatTaskItem } from '@/extensions/flat-task-item'
import { Tab } from '@/extensions/tab'

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
    <div ref={scrollRef} className="h-full overflow-auto">
      <EditorContent editor={editor} className="h-full" />
    </div>
  )
}

export default VisualEditor
