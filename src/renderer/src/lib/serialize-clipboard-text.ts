/**
 * Custom `text/plain` serializer for the visual editor's clipboard.
 *
 * ProseMirror's default `clipboardTextSerializer` is
 * `slice.content.textBetween(0, size, "\n\n")` — it emits a `\n\n` between
 * every adjacent textblock, which means an empty paragraph (used for
 * vertical spacing in the editor) produces *two* blank lines: one for its
 * own `\n\n` and one for the trailing block's `\n\n`. Stack a few empty
 * paragraphs together and the pasted output ends up with five-plus blank
 * lines between sections — see the bug report screenshots.
 *
 * We instead walk the slice ourselves, emit one logical "line" per block,
 * and join with a single `\n`. Empty paragraphs become empty strings and
 * collapse to a single blank line each — matching the original
 * electron-app editor's behavior. We also prefix list items with `- ` /
 * `1. ` and task items with `[ ]` / `[x]` so the plain text round-trips
 * back to readable markdown when pasted into another editor.
 */

import type { Node as PMNode, Slice } from '@tiptap/pm/model'

const INDENT = '  '

/** Append the plain-text representation of `node` to `lines`, recursing
 *  into containers. `indent` is the current nesting level (in units of
 *  two spaces) for nested lists. */
const collectLines = (node: PMNode, lines: string[], indent: number): void => {
  const name = node.type.name

  if (name === 'bulletList' || name === 'orderedList') {
    const isOrdered = name === 'orderedList'
    const indentStr = INDENT.repeat(indent)
    let i = 0
    node.forEach((listItem) => {
      const prefix = isOrdered ? `${i + 1}. ` : '- '
      // Render the listItem's children, treating the first textblock as
      // the bullet's "headline" and any nested lists as further indented
      // continuation lines.
      const itemLines: string[] = []
      let firstTextEmitted = false
      listItem.forEach((child) => {
        if (!firstTextEmitted && child.isTextblock) {
          itemLines.push(child.textContent)
          firstTextEmitted = true
        } else {
          collectLines(child, itemLines, indent + 1)
        }
      })
      if (itemLines.length === 0) {
        lines.push(indentStr + prefix)
      } else {
        lines.push(indentStr + prefix + itemLines[0])
        for (let j = 1; j < itemLines.length; j++) {
          lines.push(itemLines[j])
        }
      }
      i++
    })
    return
  }

  if (name === 'flatTaskItem') {
    const checked = node.attrs.checked ? '[x]' : '[ ]'
    const taskIndent = typeof node.attrs.indent === 'number' ? node.attrs.indent : 0
    const indentStr = INDENT.repeat(indent + taskIndent)
    lines.push(`${indentStr}- ${checked} ${node.textContent}`)
    return
  }

  if (name === 'table') {
    // Emit each row as a tab-separated line so the structure survives
    // pasting into a spreadsheet or text editor.
    node.forEach((row) => {
      const cells: string[] = []
      row.forEach((cell) => {
        cells.push(cell.textContent)
      })
      lines.push(cells.join('\t'))
    })
    return
  }

  if (node.isTextblock) {
    // paragraph, heading, codeBlock, blockquote's inner paragraph — the
    // visible text content, no syntax markers. Empty textblocks emit ''
    // which becomes a blank line after the join.
    lines.push(INDENT.repeat(indent) + node.textContent)
    return
  }

  // doc, blockquote, tableRow handled above, anything else: descend.
  node.forEach((child) => collectLines(child, lines, indent))
}

export const serializeSliceToText = (slice: Slice): string => {
  const lines: string[] = []
  slice.content.forEach((node) => collectLines(node, lines, 0))
  return lines.join('\n')
}
