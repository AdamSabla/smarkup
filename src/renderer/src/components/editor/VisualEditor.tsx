import { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Paragraph } from '@tiptap/extension-paragraph'
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
import { ListCommands } from '@/extensions/list-commands'
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

// The U+00A0 codepoint (non-breaking space) we use to mark empty paragraphs
// in serialized markdown. See PreservingParagraph for why.
const EMPTY_PARAGRAPH_MARKER = '\u00a0'

// Markdown is a lossy container for empty paragraphs: prosemirror-markdown
// serializes an empty paragraph as a blank line, and markdown-it then
// collapses any number of consecutive blank lines into a single paragraph
// boundary on the way back in. So pressing Enter twice in the visual editor
// produces paragraphs that evaporate on the first visual → raw → visual
// round-trip, stripping the user's vertical whitespace.
//
// Fix: override the paragraph serializer so empty paragraphs emit a single
// U+00A0 (non-breaking space). markdown-it treats that line as non-blank,
// so it survives as a real paragraph node, and the round-trip becomes
// stable. The matching stripEmptyParagraphMarkers() pass (see below) turns
// those markers back into truly empty paragraphs after parse so the user
// never sees or has to step past the invisible char while editing.
const PreservingParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            write: (s: string) => void
            renderInline: (n: unknown) => void
            closeBlock: (n: unknown) => void
          },
          node: { content: { size: number } }
        ) {
          if (node.content.size === 0) {
            state.write(EMPTY_PARAGRAPH_MARKER)
          } else {
            state.renderInline(node)
          }
          state.closeBlock(node)
        },
        parse: {}
      }
    }
  }
})

/**
 * Replace any paragraph whose sole content is our empty-paragraph marker
 * (see PreservingParagraph) with a truly empty paragraph. Runs after every
 * content load so the user sees and edits plain empty paragraphs — our
 * serializer re-emits the marker on the way out, keeping the visual ↔ raw
 * round-trip stable.
 */
const stripEmptyParagraphMarkers = (editor: Editor): void => {
  const { state } = editor
  const tr = state.tr
  let modified = false
  state.doc.descendants((node, pos) => {
    if (
      node.type.name === 'paragraph' &&
      node.childCount === 1 &&
      node.firstChild?.isText === true &&
      node.firstChild.text === EMPTY_PARAGRAPH_MARKER
    ) {
      const from = tr.mapping.map(pos + 1)
      const to = tr.mapping.map(pos + 1 + node.content.size)
      tr.delete(from, to)
      modified = true
    }
  })
  if (modified) {
    tr.setMeta('addToHistory', false)
    editor.view.dispatch(tr)
  }
}

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

const VisualEditor = ({ value, onChange, isActive }: Props): React.JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastEmittedMarkdown = useRef(value)
  // Gate onUpdate on actual user interaction. Any extension-level transaction
  // that fires at mount (e.g. a normalization appendTransaction) triggers
  // Tiptap's onUpdate without the preventUpdate meta, which would otherwise
  // re-serialize the doc to markdown and rewrite tab.content the moment we
  // flip visual ↔ raw. Each mode switch remounts a fresh editor, so this ref
  // starts false on every mount and pure mode-toggling can never mutate content.
  const hasUserEditedRef = useRef(false)
  // Keep `onChange` reachable from tiptap's onUpdate without recreating the
  // editor on every parent re-render. Updating in an effect instead of during
  // render satisfies react-hooks/refs and is equivalent in practice — the
  // onUpdate handler only fires from user input after commit.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        // Replaced by PlainText below — see comment on PlainText for why.
        text: false,
        // Replaced by PreservingParagraph below — see comment on
        // PreservingParagraph for why (empty-paragraph round-trip).
        paragraph: false,
        // TrailingNode appends an empty paragraph via appendTransaction when
        // the doc doesn't already end in one. That transaction fires without
        // the preventUpdate meta, so Tiptap's onUpdate runs, re-serializes
        // the whole doc to markdown, and silently rewrites tab.content the
        // moment the editor mounts — making a plain "switch visual → raw"
        // show altered text. Disable it; clicking past the last block to
        // add content is a minor ergonomics loss compared to that bug.
        trailingNode: false
      }),
      PreservingParagraph,
      PlainText,
      FlatTaskItem,
      // Registered after FlatTaskItem so its Mod-Shift-L / 7 / 8 shortcuts
      // take precedence over Tiptap's defaults and unify conversion across
      // bullet / ordered / task lists. See extensions/list-commands.ts.
      ListCommands,
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
      // Drop updates that fire before the user has actually edited — see
      // hasUserEditedRef declaration above for why.
      if (!hasUserEditedRef.current) return
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

  // Mark the editor as user-edited on any real input event. These fire from
  // user interaction only, not from programmatic transactions — so the
  // onUpdate gate above stays closed through mount-time normalization but
  // opens the moment the user starts working.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const markEdited = (): void => {
      hasUserEditedRef.current = true
    }
    const events = ['beforeinput', 'keydown', 'paste', 'drop', 'cut', 'compositionstart'] as const
    for (const evt of events) dom.addEventListener(evt, markEdited)
    return () => {
      for (const evt of events) dom.removeEventListener(evt, markEdited)
    }
  }, [editor])

  // Strip our empty-paragraph markers from the initial content. `useEditor`
  // seeds the doc from `content: value` synchronously during editor
  // creation, so by the time this effect runs the markers are already in
  // the doc as text nodes — we convert them back to truly empty paragraphs
  // here. Subsequent loads (file watcher, mode-switch remount) are handled
  // inside the value-reconciliation effect below.
  useEffect(() => {
    if (!editor) return
    stripEmptyParagraphMarkers(editor)
  }, [editor])

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
      // Reset the user-edited flag — this is an external reload (file watcher,
      // mode switch remount, etc.), not user input. Any onUpdate fired by
      // setContent or by follow-up mount-time normalization must not escape.
      hasUserEditedRef.current = false
      editor.commands.setContent(value, { emitUpdate: false })
      lastEmittedMarkdown.current = value
      // Convert any empty-paragraph markers in the freshly-loaded content
      // back to truly empty paragraphs so they aren't visible to the user.
      stripEmptyParagraphMarkers(editor)
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
