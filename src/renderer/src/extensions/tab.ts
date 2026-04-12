import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { MAX_INDENT_LEVEL } from './flat-task-item'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tab: {
      sinkItems: () => ReturnType
      liftItems: () => ReturnType
    }
  }
}

function getListItems(state: { doc: PMNode; selection: { from: number; to: number } }) {
  const nodes: Array<{ node: PMNode; pos: number }> = []

  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos, parent) => {
    if (parent === state.doc && node.type.name === 'flatTaskItem') {
      nodes.push({ node, pos })
    }
  })

  return nodes
}

export const Tab = Extension.create({
  name: 'tab',

  addCommands() {
    return {
      sinkItems:
        () =>
        ({ dispatch, state, tr, editor }) => {
          if (!editor.isEditable) return false

          const items = getListItems(state)
          if (items.length === 0) return false

          if (dispatch) {
            items.forEach(({ pos, node }) => {
              const indent = node.attrs.indent ?? 0
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                indent: Math.min(indent + 1, MAX_INDENT_LEVEL)
              })
            })
          }

          return true
        },

      liftItems:
        () =>
        ({ dispatch, state, tr, editor }) => {
          if (!editor.isEditable) return false

          const items = getListItems(state)
          if (items.length === 0) return false

          if (dispatch) {
            const paragraph = state.schema.nodes.paragraph

            items.forEach(({ pos, node }) => {
              const indent = node.attrs.indent ?? 0
              if (indent > 0) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  indent: indent - 1
                })
              } else {
                tr.setNodeMarkup(pos, paragraph)
              }
            })
          }

          return true
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => editor.commands.sinkItems(),
      'Shift-Tab': ({ editor }) => editor.commands.liftItems(),
      'Mod-]': ({ editor }) => editor.commands.sinkItems(),
      'Mod-[': ({ editor }) => editor.commands.liftItems()
    }
  }
})
