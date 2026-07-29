import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { openPartial, partialRefOf } from '@/lib/partials'

/**
 * Visual-editor counterpart to RawEditor's `placeholderHighlighter` — draws a
 * fuchsia highlight over every `{{variable}}` match in the document so the
 * Variables panel's chips are color-matched in both editors. Implemented as a
 * plain ProseMirror plugin with inline decorations so it doesn't touch the
 * document model (no mark schema, no serializer changes).
 *
 * Import placeholders (`{{> _shared/x}}`) additionally become links to the
 * file they name: an open icon rides along at the end of the span, and
 * mod-clicking anywhere in it opens that file. Both are decorations too, so
 * none of this reaches the document or the serialized markdown.
 *
 * The regex mirrors `VARIABLE_RE` in `lib/variables.ts` so panel, raw editor,
 * and visual editor all agree on what counts as a placeholder.
 */
const VARIABLE_RE = /\{\{[^}]+\}\}/g
const variableHighlightKey = new PluginKey('variable-highlight')

const isMac = navigator.userAgent.toLowerCase().includes('mac')
const MOD_LABEL = isMac ? '⌘' : 'Ctrl'

/** The little "open this file" affordance drawn after an import placeholder. */
const openIcon = (ref: string) => (): HTMLElement => {
  const el = document.createElement('span')
  el.className = 'smarkup-partial-open'
  el.dataset.partialRef = ref
  el.setAttribute('role', 'button')
  el.setAttribute('contenteditable', 'false')
  el.title = `Open ${ref}`
  // Inline SVG rather than a lucide component: decorations are raw DOM, so
  // this keeps the widget dependency-free.
  el.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>'
  return el
}

const buildDecorations = (doc: PMNode): DecorationSet => {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    VARIABLE_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = VARIABLE_RE.exec(node.text))) {
      const from = pos + match.index
      const to = from + match[0].length
      const ref = partialRefOf(match[0])
      decos.push(
        Decoration.inline(from, to, {
          class: `smarkup-variable-highlight${ref ? ' smarkup-partial-ref' : ''}`,
          ...(ref ? { 'data-partial-ref': ref, title: `${MOD_LABEL}-click to open ${ref}` } : {})
        })
      )
      if (ref) decos.push(Decoration.widget(to, openIcon(ref), { side: 1 }))
    }
    return false
  })
  return DecorationSet.create(doc, decos)
}

/** The reference under an event target, if the pointer landed on one. */
const refAt = (target: EventTarget | null): string | null => {
  if (!(target instanceof HTMLElement)) return null
  return target.closest<HTMLElement>('[data-partial-ref]')?.dataset.partialRef ?? null
}

export const VariableHighlighter = Extension.create({
  name: 'variableHighlighter',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: variableHighlightKey,
        state: {
          init: (_cfg, state: EditorState) => buildDecorations(state.doc),
          apply: (tr: Transaction, old: DecorationSet) =>
            tr.docChanged ? buildDecorations(tr.doc) : old.map(tr.mapping, tr.doc)
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
          handleDOMEvents: {
            // Claimed on mousedown so the caret never moves first: a mod-click
            // that also dropped the cursor into the middle of the reference
            // would leave the editor somewhere the user didn't ask to be.
            mousedown: (_view, event) => {
              const el = event.target instanceof HTMLElement ? event.target : null
              const onIcon = !!el?.closest('.smarkup-partial-open')
              if (!onIcon && !(isMac ? event.metaKey : event.ctrlKey)) return false
              const ref = refAt(event.target)
              if (!ref) return false
              event.preventDefault()
              void openPartial(ref)
              return true
            }
          }
        }
      })
    ]
  }
})
