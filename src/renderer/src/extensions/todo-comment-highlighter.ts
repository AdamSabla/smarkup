import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Visual-editor counterpart to RawEditor's comment and TODO highlighters —
 * draws a gray overlay over `// …` JS-style comments and a yellow chip over
 * `TODO` tokens so both editors render the user's annotation conventions
 * identically. Pure ProseMirror inline decorations: no schema or serializer
 * changes, so the markdown round-trip stays untouched.
 *
 * Regexes mirror lib/todos.ts so the panel chip and the highlight always
 * agree on what counts as a TODO / comment.
 */
const COMMENT_RE = /(?<!:)\/\/[^\n]*/g
const TODO_RE = /\bTODO(?::\{[^}]*\})?(?!\w)/g
const todoCommentKey = new PluginKey('todo-comment-highlight')
const todoAutoBracketKey = new PluginKey('todo-auto-bracket')

const buildDecorations = (doc: PMNode): DecorationSet => {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const text = node.text

    // Comments first; TODO decorations are pushed after so they win in the
    // overlap region (ProseMirror applies later inline decorations on top).
    COMMENT_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = COMMENT_RE.exec(text))) {
      decos.push(
        Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
          class: 'smarkup-comment-highlight'
        })
      )
    }

    TODO_RE.lastIndex = 0
    while ((m = TODO_RE.exec(text))) {
      decos.push(
        Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
          class: 'smarkup-todo-highlight'
        })
      )
    }

    return false
  })
  return DecorationSet.create(doc, decos)
}

export const TodoCommentHighlighter = Extension.create({
  name: 'todoCommentHighlighter',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: todoCommentKey,
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
      }),
      // Auto-expand `TODO:` into `TODO:{|}` so the user can immediately type
      // the description body without manually balancing braces. Mirrors the
      // CodeMirror inputHandler in RawEditor — keep them in lockstep.
      new Plugin({
        key: todoAutoBracketKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== ':' || from !== to) return false
            const $from = view.state.doc.resolve(from)
            // Only the parent text content matters — we look 4 chars back for
            // "TODO" plus one more to confirm a non-word boundary before it.
            const parentStart = $from.start()
            const sliceFrom = Math.max(parentStart, from - 5)
            const before = view.state.doc.textBetween(sliceFrom, from, '\0', '\0')
            if (!/(?:^|\W)TODO$/.test(before)) return false
            const tr = view.state.tr.insertText(':{}', from, to)
            tr.setSelection(TextSelection.create(tr.doc, from + 2))
            view.dispatch(tr)
            return true
          }
        }
      })
    ]
  }
})
