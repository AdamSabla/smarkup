import { CodeBlock } from '@tiptap/extension-code-block'
import { useWorkspace } from '@/store/workspace'
import { isMermaidLanguage } from '@/lib/mermaid'

/**
 * The control cluster in the top-right corner of every fenced code block: a
 * language picker and a copy button always, plus a diagram preview when the
 * fence is tagged `mermaid`.
 *
 * The picker is the only way to tag a fence from the visual editor. Typing
 * ```mermaid works while the block is being created and never again — once
 * the fence exists, its info string lives in an attribute with nothing on
 * screen to show it, so a block that was opened plain stays plain and the
 * preview button it would have earned never appears. A `<select>` puts that
 * attribute where the rest of the block's affordances already are, and being
 * a real one means the platform supplies the popup, the keyboard handling and
 * type-ahead rather than this file reinventing them.
 *
 * Selecting a fenced block by hand is the one thing the visual editor is worse
 * at than the raw one: the caret enters the code on mousedown, a drag from the
 * first character stops at the viewport edge, and ⌘A takes the whole document.
 * A button takes the guesswork out, and by convention that button lives in the
 * corner of the block. The preview joins it there because a mermaid fence is
 * the one kind of code in a markdown file that isn't meant to be read as text —
 * the source is the means, the chart is the point.
 *
 * Built as a plain-DOM node view rather than a React one — the buttons hold a
 * single boolean of state, and keeping them out of React means ProseMirror
 * stays the only thing writing to this part of the document's DOM. Opening the
 * preview therefore goes through the workspace store, which is the one channel
 * this node view and the React tree already share. The cluster sits outside
 * `<pre>` so a long line scrolling horizontally can't carry it away, and
 * `renderHTML` is untouched, so what gets copied, pasted or serialized is still
 * a plain `pre > code`.
 */

/** How long the tick stays up before the button offers the copy again. */
const CONFIRM_MS = 1600

/**
 * What the picker offers, as `[fence info string, label]`.
 *
 * Deliberately a short list of the tags people actually write after three
 * backticks, not every language a highlighter knows. The empty value is a
 * fence with no info string at all, which is what most blocks are. A document
 * tagged with something outside this list keeps its tag — see `syncLanguage`,
 * which adds it as an option rather than quietly rewriting the file.
 */
const LANGUAGES: [value: string, label: string][] = [
  ['', 'Plain text'],
  ['bash', 'Bash'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['css', 'CSS'],
  ['diff', 'Diff'],
  ['dockerfile', 'Dockerfile'],
  ['go', 'Go'],
  ['graphql', 'GraphQL'],
  ['html', 'HTML'],
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['json', 'JSON'],
  ['jsx', 'JSX'],
  ['kotlin', 'Kotlin'],
  ['lua', 'Lua'],
  ['makefile', 'Makefile'],
  ['markdown', 'Markdown'],
  ['mermaid', 'Mermaid'],
  ['php', 'PHP'],
  ['python', 'Python'],
  ['ruby', 'Ruby'],
  ['rust', 'Rust'],
  ['scss', 'SCSS'],
  ['sh', 'Shell'],
  ['sql', 'SQL'],
  ['swift', 'Swift'],
  ['toml', 'TOML'],
  ['tsx', 'TSX'],
  ['typescript', 'TypeScript'],
  ['xml', 'XML'],
  ['yaml', 'YAML']
]

/** A lucide icon node: the tag and its attributes, as lucide ships them. */
type IconPart = [tag: string, attrs: Record<string, string>]

const svg = (parts: IconPart[]): SVGSVGElement => {
  const ns = 'http://www.w3.org/2000/svg'
  const root = document.createElementNS(ns, 'svg')
  root.setAttribute('viewBox', '0 0 24 24')
  root.setAttribute('fill', 'none')
  root.setAttribute('stroke', 'currentColor')
  root.setAttribute('stroke-width', '2')
  root.setAttribute('stroke-linecap', 'round')
  root.setAttribute('stroke-linejoin', 'round')
  root.setAttribute('aria-hidden', 'true')
  for (const [tag, attrs] of parts) {
    const child = document.createElementNS(ns, tag)
    for (const [name, value] of Object.entries(attrs)) child.setAttribute(name, value)
    root.append(child)
  }
  return root
}

// lucide `copy`, `check` and `workflow`, as raw nodes so the node view stays
// out of React. `workflow` — two boxes joined by an elbow — rather than an eye,
// which the tab bar already uses for the document preview toggle.
const copyIcon = (): SVGSVGElement =>
  svg([
    ['path', { d: 'M20 8H10a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2z' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]
  ])
const checkIcon = (): SVGSVGElement => svg([['path', { d: 'M20 6 9 17l-5-5' }]])
const diagramIcon = (): SVGSVGElement =>
  svg([
    ['rect', { width: '8', height: '8', x: '3', y: '3', rx: '2' }],
    ['path', { d: 'M7 11v4a2 2 0 0 0 2 2h4' }],
    ['rect', { width: '8', height: '8', x: '13', y: '13', rx: '2' }]
  ])

export const CodeBlockActions = CodeBlock.extend({
  addNodeView() {
    const { languageClassPrefix } = this.options

    return ({ node: initialNode, HTMLAttributes, editor, getPos }) => {
      let node = initialNode
      let confirmTimer: ReturnType<typeof setTimeout> | undefined

      const dom = document.createElement('div')
      dom.className = 'smarkup-code-block'

      const pre = document.createElement('pre')
      for (const [key, value] of Object.entries(HTMLAttributes)) {
        if (value != null) pre.setAttribute(key, String(value))
      }
      const code = document.createElement('code')
      // Same class `renderHTML` would have written, so a fence's language
      // survives into the DOM for anything that wants to highlight it.
      const languageClass = (attrs: { language?: string | null }): string =>
        attrs.language ? languageClassPrefix + attrs.language : ''
      code.className = languageClass(node.attrs)
      pre.append(code)

      const actions = document.createElement('div')
      actions.className = 'smarkup-code-actions'
      actions.contentEditable = 'false'

      const makeButton = (label: string, icon: SVGSVGElement): HTMLButtonElement => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'smarkup-code-action'
        button.contentEditable = 'false'
        button.tabIndex = -1
        button.setAttribute('aria-label', label)
        button.title = label
        button.append(icon)
        // Without this the press lands in the code and drops a caret there
        // before the click ever fires.
        button.addEventListener('mousedown', (event) => event.preventDefault())
        return button
      }

      // --- Language ------------------------------------------------------
      const language = document.createElement('select')
      language.className = 'smarkup-code-language'
      language.contentEditable = 'false'
      // Out of the tab order: ⇥ inside a code block indents the code, and the
      // cluster is a pointer affordance on a block the caret is already in.
      language.tabIndex = -1
      language.setAttribute('aria-label', 'Code language')
      language.title = 'Code language'

      /** The fence's info string, normalised the way the picker stores it. */
      const currentLanguage = (): string =>
        ((node.attrs.language as string | null) ?? '').trim().toLowerCase()

      /** The out-of-list tag currently carried as an extra option, if any. */
      let extra: string | null = null

      const fillOptions = (): void => {
        const options = LANGUAGES.map(([value, label]) => {
          const option = document.createElement('option')
          option.value = value
          option.textContent = label
          return option
        })
        if (extra !== null) {
          const option = document.createElement('option')
          option.value = extra
          option.textContent = extra
          options.push(option)
        }
        language.replaceChildren(...options)
      }

      const syncLanguage = (): void => {
        const value = currentLanguage()
        const unknown = value && !LANGUAGES.some(([known]) => known === value) ? value : null
        if (unknown !== extra) {
          extra = unknown
          fillOptions()
        }
        if (language.value !== value) language.value = value
      }

      language.addEventListener('change', () => {
        const pos = getPos()
        if (pos == null) return
        const { view } = editor
        view.dispatch(
          view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            language: language.value || null
          })
        )
        // The popup leaves focus on the select. Hand it back, or the next
        // keystroke goes to the picker's type-ahead instead of the document.
        view.focus()
      })

      // --- Preview -------------------------------------------------------
      // Created up front and attached only while the fence is a mermaid one,
      // so retagging a block doesn't need a whole new node view.
      const preview = makeButton('Preview diagram', diagramIcon())
      preview.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        useWorkspace.getState().openMermaidPreview(node.textContent)
      })

      const syncPreview = (): void => {
        const wanted = isMermaidLanguage(node.attrs.language as string | null)
        if (wanted === actions.contains(preview)) return
        // Before the copy button, which is the cluster's constant — so the
        // preview appearing never shifts the picker out from under the
        // pointer that just chose `mermaid` in it.
        if (wanted) copy.before(preview)
        else preview.remove()
      }

      // --- Copy ----------------------------------------------------------
      const copy = makeButton('Copy code', copyIcon())

      const setCopyLabel = (label: string): void => {
        copy.setAttribute('aria-label', label)
        copy.title = label
      }

      const confirm = (ok: boolean): void => {
        copy.replaceChildren(ok ? checkIcon() : copyIcon())
        copy.classList.toggle('is-copied', ok)
        setCopyLabel(ok ? 'Copied' : "Couldn't copy")
        clearTimeout(confirmTimer)
        confirmTimer = setTimeout(() => {
          copy.replaceChildren(copyIcon())
          copy.classList.remove('is-copied')
          setCopyLabel('Copy code')
        }, CONFIRM_MS)
      }

      copy.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        // Electron's clipboard over IPC rather than `navigator.clipboard`,
        // which wants a focused document and a granted permission — see
        // lib/copy-path.ts for the same reasoning.
        window.api
          .copyToClipboard(node.textContent)
          .then(() => confirm(true))
          .catch(() => {
            confirm(false)
            useWorkspace.getState().showToast("Couldn't copy the code to the clipboard", 'error')
          })
      })

      actions.append(language, copy)
      fillOptions()
      syncLanguage()
      syncPreview()
      dom.append(pre, actions)

      return {
        dom,
        contentDOM: code,
        update: (updated) => {
          if (updated.type !== node.type) return false
          node = updated
          code.className = languageClass(node.attrs)
          // A fence becomes previewable the moment someone types `mermaid`
          // after the backticks, or picks it in the language menu.
          syncLanguage()
          syncPreview()
          return true
        },
        // The buttons are ours, not the document's: keep ProseMirror from
        // reading an icon swap as an edit, or a click as a selection.
        ignoreMutation: (mutation) => actions.contains(mutation.target),
        stopEvent: (event) => event.target instanceof Node && actions.contains(event.target),
        destroy: () => clearTimeout(confirmTimer)
      }
    }
  }
})
