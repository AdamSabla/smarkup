import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { DOMParser, Slice } from '@tiptap/pm/model'

/**
 * When the user pastes plain text that clearly looks like HTML markup, don't
 * run it through the markdown parser — that path (tiptap-markdown with
 * html: false) escapes the tags to entities, splits on newlines, and leaves
 * indentation that re-parses as an indented code block on the next round-trip.
 *
 * Instead, drop the text straight into a single paragraph with hard breaks
 * between lines. That round-trips cleanly: the saved markdown becomes one
 * paragraph (html_block in markdown-it) and re-parsing yields the same
 * paragraph back.
 *
 * Heuristic: paste starts with `<tag…` — cheap and the false-positive cost
 * is "preserved as plain text," which is what you'd want anyway.
 *
 * Registered with priority 100 so it runs before tiptap-markdown's clipboard
 * plugin (priority 50). Returning `null` from clipboardTextParser lets
 * ProseMirror fall through to the next plugin, so non-HTML pastes still go
 * through the markdown parser and render as rich content.
 */
const looksLikeHtml = (text: string): boolean => /^\s*<[a-zA-Z!]/.test(text)

export const HtmlPaste = Extension.create({
  name: 'htmlPaste',
  priority: 100,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('htmlPaste'),
        props: {
          // ProseMirror's someProp() iteration treats a null/undefined return
          // as "not handled" and moves on to the next plugin. The types don't
          // advertise this, so we cast the falsy returns to Slice.
          clipboardTextParser: (text, $context, plainText, view): Slice => {
            if (plainText || !looksLikeHtml(text)) return null as unknown as Slice

            const { schema } = view.state
            const hardBreak = schema.nodes.hardBreak
            const paragraph = schema.nodes.paragraph
            if (!hardBreak || !paragraph) return null as unknown as Slice

            // Build a <p> with <br> between source lines, then parseSlice so
            // ProseMirror handles context/open-boundary merging the same way
            // it would for any rich paste.
            const dom = document.createElement('div')
            const p = dom.appendChild(document.createElement('p'))
            const lines = text.split(/\r\n?|\n/)
            lines.forEach((line, i) => {
              if (i > 0) p.appendChild(document.createElement('br'))
              if (line) p.appendChild(document.createTextNode(line))
            })

            return DOMParser.fromSchema(schema).parseSlice(dom, {
              preserveWhitespace: true,
              context: $context
            }) as Slice
          }
        }
      })
    ]
  }
})
