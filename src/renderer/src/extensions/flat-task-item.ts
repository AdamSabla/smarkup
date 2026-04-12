import { Node, mergeAttributes, textblockTypeInputRule, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { canSplit } from '@tiptap/pm/transform'
import type { Node as PMNode, NodeType } from '@tiptap/pm/model'
import taskListPlugin from 'markdown-it-task-lists'

export const MAX_INDENT_LEVEL = 8

const taskListPluginRegistered = new WeakSet<object>()

function clampIndent(n: number): number {
  const v = isNaN(n) ? 0 : n
  return Math.max(0, Math.min(v, MAX_INDENT_LEVEL))
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getTopItems(state: Editor['state']) {
  const nodes: Array<{ node: PMNode; pos: number }> = []
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos, parent) => {
    if (parent === state.doc) {
      nodes.push({ node, pos })
    }
  })
  return nodes
}

function toggleTaskList(editor: Editor, taskItemType: NodeType): boolean {
  if (!editor.isEditable) return false

  const items = getTopItems(editor.state)
  if (items.length === 0) return false

  const paragraph = editor.state.schema.nodes.paragraph
  const allAreTaskItems = items.every(({ node }) => node.type === taskItemType)

  return editor
    .chain()
    .command(({ tr }) => {
      items.forEach(({ node, pos }) => {
        if (allAreTaskItems) {
          tr.setNodeMarkup(pos, paragraph)
        } else {
          tr.setNodeMarkup(pos, taskItemType, {
            indent: typeof node.attrs.indent === 'number' ? node.attrs.indent : 0
          })
        }
      })
      return true
    })
    .run()
}

/* ------------------------------------------------------------------ */
/*  DOM flattening: nested task-list HTML → flat divs                  */
/* ------------------------------------------------------------------ */

function collectFlatItems(
  list: Element,
  indent: number,
  items: HTMLDivElement[],
  doc: Document
): void {
  for (const child of [...list.children]) {
    if (child.tagName !== 'LI') continue

    const input = child.querySelector(':scope > input[type="checkbox"]')
    const checked = (input as HTMLInputElement)?.checked ?? false

    const div = doc.createElement('div')
    div.setAttribute('data-type', 'flatTaskItem')
    div.setAttribute('data-indent', String(indent))
    div.setAttribute('data-checked', String(checked))

    let isFirstTextNode = true
    for (const node of [...child.childNodes]) {
      if (node instanceof Element && (node.tagName === 'UL' || node.tagName === 'OL')) continue
      if (
        node instanceof Element &&
        node.tagName === 'INPUT' &&
        (node as HTMLInputElement).type === 'checkbox'
      )
        continue
      const clone = node.cloneNode(true)
      if (isFirstTextNode && clone.nodeType === 3 && clone.textContent) {
        clone.textContent = clone.textContent.replace(/^\s+/, '')
      }
      if (clone.nodeType === 3 && clone.textContent === '') continue
      div.appendChild(clone)
      if (clone.nodeType === 3) isFirstTextNode = false
    }

    items.push(div)

    for (const nested of [...child.children]) {
      if (nested.tagName === 'UL' || nested.tagName === 'OL') {
        collectFlatItems(nested, indent + 1, items, doc)
      }
    }
  }
}

function flattenTaskListDOM(element: Element): void {
  const topLevelLists = [...element.querySelectorAll('.contains-task-list')].filter(
    (list) => !list.parentElement?.closest('.contains-task-list')
  )

  for (const taskList of topLevelLists) {
    const items: HTMLDivElement[] = []
    collectFlatItems(taskList, 0, items, element.ownerDocument)

    const fragment = element.ownerDocument.createDocumentFragment()
    for (const div of items) fragment.appendChild(div)
    taskList.replaceWith(fragment)
  }
}

function flattenPastedHTML(html: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  const lists = [...doc.querySelectorAll('ul, ol')]
    .filter((list) => !list.parentElement?.closest('ul, ol'))
    .filter((list) => {
      const lis = list.querySelectorAll(':scope > li')
      return [...lis].some(
        (li) =>
          li.querySelector(':scope > input[type="checkbox"]') ||
          li.classList.contains('task-list-item')
      )
    })

  for (const list of lists) {
    const items: HTMLDivElement[] = []
    collectFlatItems(list, 0, items, doc)

    const fragment = doc.createDocumentFragment()
    for (const div of items) fragment.appendChild(div)
    list.replaceWith(fragment)
  }

  return doc.body.innerHTML
}

/* ------------------------------------------------------------------ */
/*  Extension                                                          */
/* ------------------------------------------------------------------ */

export const FlatTaskItem = Node.create({
  name: 'flatTaskItem',

  group: 'block',

  content: 'inline*',

  defining: true,

  addAttributes() {
    return {
      indent: {
        default: 0,
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('data-indent')
          if (raw) return clampIndent(parseInt(raw, 10))
          const aria = el.getAttribute('aria-level')
          if (aria) return clampIndent(parseInt(aria, 10) - 1)
          return 0
        }
      },
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) =>
          el.getAttribute('data-checked') === 'true' ||
          el.getAttribute('aria-checked') === 'true'
      }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="flatTaskItem"]',
        priority: 100,
        contentElement: (dom: HTMLElement) => {
          const inner = dom.querySelector(':scope > div:not([data-type])')
          return inner ?? dom
        }
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'flatTaskItem',
        'data-checked': String(node.attrs.checked),
        'data-indent': String(node.attrs.indent),
        style: `--indent-level: ${node.attrs.indent}`
      }),
      [
        'label',
        { contenteditable: 'false' },
        ['input', { type: 'checkbox', ...(node.attrs.checked ? { checked: '' } : {}) }],
        ['span']
      ],
      ['div', 0]
    ]
  },

  addNodeView() {
    return ({ node: initialNode, HTMLAttributes, getPos, editor }) => {
      let node = initialNode
      const dom = document.createElement('div')
      dom.setAttribute('data-type', 'flatTaskItem')
      dom.setAttribute('data-checked', String(node.attrs.checked))
      dom.style.setProperty('--indent-level', String(node.attrs.indent))

      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        if (key !== 'style' && key !== 'data-type' && key !== 'data-checked') {
          dom.setAttribute(key, String(value))
        }
      })

      const checkboxWrapper = document.createElement('label')
      checkboxWrapper.contentEditable = 'false'

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = node.attrs.checked

      const checkboxStyler = document.createElement('span')
      const content = document.createElement('div')

      checkbox.addEventListener('change', (event) => {
        if (!editor.isEditable) {
          checkbox.checked = !checkbox.checked
          return
        }
        const { checked } = event.target as HTMLInputElement
        if (typeof getPos === 'function') {
          const position = getPos()
          if (position == null) return
          editor
            .chain()
            .focus(undefined, { scrollIntoView: false })
            .command(({ tr }) => {
              const currentNode = tr.doc.nodeAt(position)
              if (!currentNode) return false
              tr.setNodeMarkup(position, undefined, { ...currentNode.attrs, checked })
              return true
            })
            .run()
        }
      })

      checkboxWrapper.append(checkbox, checkboxStyler)
      dom.append(checkboxWrapper, content)

      return {
        dom,
        contentDOM: content,
        update: (updatedNode: PMNode) => {
          if (updatedNode.type.name !== 'flatTaskItem') return false
          dom.setAttribute('data-checked', String(updatedNode.attrs.checked))
          dom.style.setProperty('--indent-level', String(updatedNode.attrs.indent))
          checkbox.checked = updatedNode.attrs.checked
          node = updatedNode
          return true
        }
      }
    }
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^\s*(\[([( |x])?\])\s$/,
        type: this.type,
        getAttributes: (match) => ({
          checked: match[match.length - 1] === 'x'
        })
      })
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $from, $to, empty } = editor.state.selection
        if ($from.parent.type !== this.type) return false

        if (empty && $from.parent.content.size === 0) {
          const indent = $from.parent.attrs.indent
          if (typeof indent === 'number' && indent > 0) {
            return editor.commands.command(({ dispatch, tr }) => {
              if (dispatch) {
                tr.setNodeMarkup($from.before($from.depth), undefined, {
                  ...$from.parent.attrs,
                  indent: indent - 1
                })
              }
              return true
            })
          }
          return editor.commands.clearNodes()
        }

        if (!empty) return false

        const atLineStart = $to.parentOffset === 0
        const atLineEnd = $to.parentOffset === $to.parent.content.size
        const indent = $to.parent.attrs.indent ?? 0

        if (atLineStart || atLineEnd) {
          const position = atLineStart ? $to.start() - 1 : $to.end() + 1
          const cursorPosition = atLineStart ? position + 3 : position + 1

          return editor
            .chain()
            .insertContentAt(position, { type: this.type.name, attrs: { indent } })
            .setTextSelection(cursorPosition)
            .scrollIntoView()
            .run()
        }

        return editor
          .chain()
          .command(({ dispatch, tr, state }) => {
            if (!canSplit(state.doc, $from.pos, 1)) return false
            if (dispatch) tr.split($from.pos, 1)
            return true
          })
          .scrollIntoView()
          .run()
      },

      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection
        if ($from.parent.type !== this.type) return false

        if (empty && $from.parent.content.size === 0) {
          const indent = $from.parent.attrs.indent
          if (typeof indent === 'number' && indent > 0) {
            return editor.commands.command(({ dispatch, tr }) => {
              if (dispatch) {
                tr.setNodeMarkup($from.before($from.depth), undefined, {
                  ...$from.parent.attrs,
                  indent: 0
                })
              }
              return true
            })
          }
          return editor.commands.clearNodes()
        }

        if (empty && $from.pos <= 1) {
          return editor.commands.clearNodes()
        }

        return false
      },

      'Mod-Shift-l': ({ editor }) => toggleTaskList(editor, this.type),

      'Mod-Enter': ({ editor }) => {
        const { from, to } = editor.state.selection
        const taskItems: Array<{ pos: number; node: PMNode }> = []

        editor.state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'flatTaskItem') {
            taskItems.push({ pos, node })
          }
        })

        if (taskItems.length === 0) return false

        const allChecked = taskItems.every((item) => item.node.attrs.checked)
        const newChecked = !allChecked

        return editor
          .chain()
          .focus()
          .command(({ tr }) => {
            for (const { pos, node } of taskItems) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: newChecked })
            }
            return true
          })
          .run()
      }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('flatTaskItemPaste'),
        props: {
          transformPastedHTML: (html: string) => flattenPastedHTML(html)
        }
      })
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            closed: PMNode | null
            flushClose: (size?: number) => void
            write: (content?: string) => void
            renderInline: (node: PMNode) => void
            closeBlock: (node: PMNode) => void
          },
          node: PMNode,
          parent: PMNode,
          index: number
        ) {
          if (
            index > 0 &&
            parent.child(index - 1).type.name === 'flatTaskItem' &&
            state.closed
          ) {
            state.flushClose(1)
          }
          const indent = '  '.repeat(node.attrs.indent ?? 0)
          const check = node.attrs.checked ? '[x]' : '[ ]'
          state.write(`${indent}- ${check} `)
          state.renderInline(node)
          state.closeBlock(node)
        },
        parse: {
          setup(markdownit: { use: (plugin: unknown) => void }) {
            if (!taskListPluginRegistered.has(markdownit)) {
              markdownit.use(taskListPlugin)
              taskListPluginRegistered.add(markdownit)
            }
          },
          updateDOM(element: HTMLElement) {
            flattenTaskListDOM(element)
          }
        }
      }
    }
  }
})
