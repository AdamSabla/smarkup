/**
 * Unified list conversion shortcuts.
 *
 * By default Tiptap treats bullet/ordered lists (`bulletList` > `listItem` >
 * `paragraph`) and our flat task items (`flatTaskItem` directly under the
 * doc) as structurally incompatible — toggling bullet → task or task → bullet
 * does nothing because the default shortcuts only toggle their own type.
 *
 * This extension registers a single set of shortcuts that detect the current
 * block's list kind (paragraph / bullet / ordered / task) and convert to the
 * target kind via a two-step transform:
 *
 *   1. `clearNodes` normalizes the selection to plain paragraphs — it lifts
 *      `listItem`s out of their parent list (splitting the list if the item
 *      is in the middle) and setNodeMarkups `flatTaskItem` → `paragraph`.
 *   2. Apply the target: `toggleBulletList`, `toggleOrderedList`, or
 *      `toggleTaskList` (which setNodeMarkups paragraphs → flatTaskItem).
 *
 * Hitting the same shortcut twice (e.g. Mod-Shift-L while already in a task
 * item) toggles back to a plain paragraph.
 */

import { Extension, type Editor } from '@tiptap/core'
import { toggleTaskList } from './flat-task-item'

type ListKind = 'bullet' | 'ordered' | 'task' | 'paragraph'

const detectListType = (editor: Editor): ListKind => {
  const $pos = editor.state.selection.$from
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d)
    const name = node.type.name
    if (name === 'flatTaskItem') return 'task'
    if (name === 'listItem') {
      const parent = d > 0 ? $pos.node(d - 1) : null
      const parentName = parent?.type.name
      if (parentName === 'orderedList') return 'ordered'
      if (parentName === 'bulletList') return 'bullet'
    }
  }
  return 'paragraph'
}

const setBlockListType = (editor: Editor, target: Exclude<ListKind, 'paragraph'>): boolean => {
  if (!editor.isEditable) return false
  const current = detectListType(editor)

  // Same type → toggle off (convert back to plain paragraph).
  if (current === target) {
    return editor.chain().focus().clearNodes().run()
  }

  // Normalize to paragraph(s), then apply the target type. `clearNodes` is
  // a no-op when we're already in a paragraph, but we skip it in that case
  // to avoid an empty transaction when the target already has a dedicated
  // wrap command.
  const chain = editor.chain().focus()
  if (current !== 'paragraph') chain.clearNodes()

  if (target === 'bullet') return chain.toggleBulletList().run()
  if (target === 'ordered') return chain.toggleOrderedList().run()

  // Task: there's no chainable command, so commit the normalization first
  // then run the toggle against the now-lifted paragraph(s).
  chain.run()
  const taskItemType = editor.schema.nodes.flatTaskItem
  if (!taskItemType) return false
  return toggleTaskList(editor, taskItemType)
}

export const ListCommands = Extension.create({
  name: 'listCommands',

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-8': ({ editor }) => setBlockListType(editor, 'bullet'),
      'Mod-Shift-7': ({ editor }) => setBlockListType(editor, 'ordered'),
      'Mod-Shift-l': ({ editor }) => setBlockListType(editor, 'task')
    }
  }
})
