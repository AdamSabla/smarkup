import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Visual-editor counterpart to RawEditor's `placeholderHighlighter` — draws a
 * fuchsia highlight over every `{{variable}}` match in the document so the
 * Variables panel's chips are color-matched in both editors. Implemented as a
 * plain ProseMirror plugin with inline decorations so it doesn't touch the
 * document model (no mark schema, no serializer changes).
 *
 * The regex mirrors `VARIABLE_RE` in `lib/variables.ts` so panel, raw editor,
 * and visual editor all agree on what counts as a placeholder.
 */
const VARIABLE_RE = /\{\{[^}]+\}\}/g
const variableHighlightKey = new PluginKey('variable-highlight')

const buildDecorations = (doc: PMNode): DecorationSet => {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    VARIABLE_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = VARIABLE_RE.exec(node.text))) {
      const from = pos + match.index
      const to = from + match[0].length
      decos.push(Decoration.inline(from, to, { class: 'smarkup-variable-highlight' }))
    }
    return false
  })
  return DecorationSet.create(doc, decos)
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
          }
        }
      })
    ]
  }
})
