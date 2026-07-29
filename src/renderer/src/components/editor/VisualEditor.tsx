import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Text } from '@tiptap/extension-text'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Markdown } from 'tiptap-markdown'
import { cn } from '@/lib/utils'
import { FlatTaskItem } from '@/extensions/flat-task-item'
import { Tab } from '@/extensions/tab'
import { HtmlPaste } from '@/extensions/html-paste'
import { ListCommands } from '@/extensions/list-commands'
import { VariableHighlighter } from '@/extensions/variable-highlighter'
import { TodoCommentHighlighter } from '@/extensions/todo-comment-highlighter'
import { SearchHighlighter } from '@/extensions/search-highlight'
import { getActiveEditor, setActiveEditor } from '@/lib/active-editor'
import { useWorkspace } from '@/store/workspace'
import { serializeSliceToText } from '@/lib/serialize-clipboard-text'
import { writeText, type MarkdownWriter } from '@/lib/markdown-escape'
import {
  getInlineProbe,
  reconcileMarkdown,
  serializeMarkdown,
  stabilizeParser
} from '@/lib/markdown-roundtrip'
import TableMenu from './TableMenu'

// tiptap-markdown's default text serializer always HTML-escapes `<` and `>`,
// so any literal angle bracket (e.g. pasted HTML, "1 < 2") becomes `&lt;`/`&gt;`
// in the saved markdown. Override it to leave text alone.
//
// It also routes through prosemirror-markdown's `state.text`, which escapes
// every character that *could* be markup whether or not it is — turning
// `highlights[]` into `highlights\[\]` and `{{> _shared/x }}` into
// `{{> \_shared/x }}`. `writeText` asks the parser instead of guessing; see
// lib/markdown-escape.ts.
const PlainText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(this: { editor: Editor }, state: MarkdownWriter, node: { text?: string }) {
          writeText(state, node.text ?? '', getInlineProbe(this.editor))
        },
        parse: {}
      }
    }
  }
})

// Empty paragraphs serialize as plain blank lines, which means several in a
// row collapse to one the next time the file is read — markdown has no way to
// say "two blank paragraphs". An earlier fix held onto them by writing a
// U+00A0 on each blank line, but that puts an invisible character into files
// that other programs read, which is exactly the kind of edit the editor is
// not allowed to make. Blank-line runs already in a file survive either way:
// regions the user didn't touch keep their original bytes (see
// lib/markdown-roundtrip.ts).

type Props = {
  tabId: string
  value: string
  onChange: (markdown: string) => void
  isActive: boolean
}

const VisualEditor = ({ tabId, value, onChange, isActive }: Props): React.JSX.Element => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const path = useWorkspace((s) => s.tabs.find((t) => t.id === tabId)?.path ?? '')
  const pathRef = useRef(path)
  useEffect(() => {
    pathRef.current = path
  }, [path])
  const getPath = useCallback(() => pathRef.current, [])
  /**
   * The buffer text this editor is currently in sync with — the file's own
   * bytes, not a rendering of them. Round-tripping edits back onto it is what
   * keeps untouched parts of the file untouched.
   */
  const lastEmittedMarkdown = useRef(value)
  /**
   * What the document rendered to when `lastEmittedMarkdown` was adopted.
   * Comparing the next render against it answers "did the document actually
   * change?" without re-parsing, and gives the merge in
   * lib/markdown-roundtrip.ts its common ancestor. Null until the editor has
   * rendered once.
   */
  const baselineMarkdown = useRef<string | null>(null)
  /**
   * True while *we* are the ones changing the doc — loading new content,
   * normalizing what came in. Transactions raised inside that window are our
   * own bookkeeping, and re-serializing them back into `tab.content` would
   * rewrite the file just for flipping visual ↔ raw.
   *
   * Starts true so mount-time normalization is covered, and is lowered once
   * the editor has settled. Everything outside the window is a real change to
   * the document — typed, pasted, or commanded (⌘Z, an outline move) — and
   * has to reach the store, whether or not a key was involved.
   */
  const applyingRef = useRef(true)
  const applyExternal = useCallback((fn: () => void): void => {
    applyingRef.current = true
    try {
      fn()
    } finally {
      applyingRef.current = false
    }
  }, [])
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
        // TrailingNode appends an empty paragraph via appendTransaction when
        // the doc doesn't already end in one. That transaction fires without
        // the preventUpdate meta, so Tiptap's onUpdate runs, re-serializes
        // the whole doc to markdown, and silently rewrites tab.content the
        // moment the editor mounts — making a plain "switch visual → raw"
        // show altered text. Disable it; clicking past the last block to
        // add content is a minor ergonomics loss compared to that bug.
        trailingNode: false
      }),
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
      // Placeholder references resolve relative to the file being edited, and
      // this editor outlives any single path (auto-rename rewrites it), so the
      // extension reads it through a ref instead of capturing it.
      VariableHighlighter.configure({ getPath }),
      TodoCommentHighlighter,
      SearchHighlighter,
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
    [getPath]
  )

  const editor = useEditor({
    extensions,
    autofocus: false,
    content: value,
    onUpdate: ({ editor: e }) => {
      // See applyingRef for what this drops and why.
      if (applyingRef.current) return
      const { text, markdown } = reconcileMarkdown(
        e,
        lastEmittedMarkdown.current,
        baselineMarkdown.current
      )
      baselineMarkdown.current = markdown
      // A transaction that comes back as the text we already had isn't a
      // change to the file — belt and braces against a stray normalization
      // pass dirtying a buffer nobody edited.
      if (text === lastEmittedMarkdown.current) return
      lastEmittedMarkdown.current = text
      onChangeRef.current(text)
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

  // Cmd/Ctrl + PageUp / PageDown: jump to previous / next heading and align
  // it to the top of the scroll container. Matches the RawEditor behaviour.
  // Attached in the capture phase on the editor's content DOM so the event
  // fires before ProseMirror's own PageUp/Down handling moves the caret by
  // a viewport.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return
      const isMac = navigator.userAgent.toLowerCase().includes('mac')
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (!mod) return
      e.preventDefault()
      e.stopPropagation()

      const { state, view } = editor
      const dir = e.key === 'PageDown' ? 1 : -1
      const caret = state.selection.$from.pos

      // Collect all top-level heading node positions in doc order.
      const positions: number[] = []
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          positions.push(pos)
          return false
        }
        return true
      })
      if (positions.length === 0) return

      let targetPos: number | null = null
      if (dir === 1) {
        for (const p of positions) {
          // Strictly > caret so Cmd+PageDown on a heading advances to the next.
          if (p > caret) {
            targetPos = p
            break
          }
        }
      } else {
        for (let i = positions.length - 1; i >= 0; i--) {
          const p = positions[i]
          // `p + 1` is the start of text inside the heading; if the caret is
          // anywhere inside the current heading, skip to the previous one.
          if (p + 1 < caret) {
            // further check: make sure caret isn't still within THIS heading
            const node = state.doc.nodeAt(p)
            const nodeEnd = node ? p + node.nodeSize : p
            if (caret > nodeEnd) {
              targetPos = p
              break
            }
          }
        }
      }
      if (targetPos === null) return

      // Caret lands at the start of the heading's text (pos + 1 enters the node).
      const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(targetPos + 1)))
      view.dispatch(tr)

      // Align the heading's DOM element to the top of the scroll container.
      const el = view.nodeDOM(targetPos) as HTMLElement | null
      const container = scrollRef.current
      if (el && container) {
        const containerTop = container.getBoundingClientRect().top
        const elTop = el.getBoundingClientRect().top
        container.scrollTo({
          top: container.scrollTop + (elTop - containerTop),
          behavior: 'smooth'
        })
      }
    }
    dom.addEventListener('keydown', handler, true)
    return () => dom.removeEventListener('keydown', handler, true)
  }, [editor])

  // `useEditor` seeds the doc from `content: value` synchronously during
  // editor creation, so by the time this effect runs the document is loaded
  // and can be measured. Subsequent loads (file watcher, mode-switch remount)
  // re-baseline inside the value-reconciliation effect below.
  useEffect(() => {
    if (!editor) return
    stabilizeParser(editor)
    baselineMarkdown.current = serializeMarkdown(editor, editor.state.doc)
    // Mount-time normalization is over; from here every transaction is a real
    // edit. See applyingRef.
    applyingRef.current = false
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
    // The buffer already says exactly what this document renders to (a raw-side
    // edit that only normalized formatting, say) — reloading would reset the
    // caret for nothing.
    if (value === baselineMarkdown.current) {
      lastEmittedMarkdown.current = value
      return
    }
    // An external reload (file watcher, mode-switch remount, an applied
    // outline), not user input — neither the load nor the normalization
    // pass behind it may escape back into the store.
    applyExternal(() => {
      editor.commands.setContent(value, { emitUpdate: false })
      lastEmittedMarkdown.current = value
      baselineMarkdown.current = serializeMarkdown(editor, editor.state.doc)
    })
  }, [value, editor, applyExternal])

  const visualSyntaxHighlight = useWorkspace((s) => s.visualSyntaxHighlight)
  useEffect(() => {
    if (!editor) return
    const el = editor.view.dom
    el.classList.toggle('syntax-highlight', visualSyntaxHighlight)
  }, [editor, visualSyntaxHighlight])

  const visualHeadingMarkers = useWorkspace((s) => s.visualHeadingMarkers)
  useEffect(() => {
    if (!editor) return
    const el = editor.view.dom
    el.classList.toggle('heading-markers', visualHeadingMarkers)
  }, [editor, visualHeadingMarkers])

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto">
      <EditorContent editor={editor} className="h-full" />
      {editor && <TableMenu editor={editor} containerRef={scrollRef} />}
    </div>
  )
}

export default VisualEditor
