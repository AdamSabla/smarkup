import { DOMParser as ProseMirrorDOMParser, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'
import { withMinimalEscaping, type InlineProbe } from './markdown-escape'
import { rebaseOntoSource } from './markdown-merge'
import { unescapeVariables } from './variables'

/**
 * Round-trip fidelity for the visual editor.
 *
 * The rule these files are held to: opening one and saving it without editing
 * must leave it byte-identical, and editing one word must change one word.
 * A document model can't promise that on its own — it holds what the markdown
 * *meant*, not how it was written, so re-rendering it is free to collapse a
 * blank run, renumber a list, or escape a bracket that was only ever an
 * identifier.
 *
 * Three things get us there, cheapest first:
 *
 *   1. If the rendering is identical to the one taken when the file loaded,
 *      the document hasn't changed and the original bytes go back untouched.
 *   2. Otherwise the rendering is rebased onto the original file, so only the
 *      blocks the edit actually touched are rewritten (see markdown-merge).
 *   3. Whatever comes out is re-parsed and re-rendered before it is trusted.
 *      If it doesn't come back identical, it is thrown away for something
 *      that does. A preserved byte is never worth a changed meaning.
 */

/**
 * The parts of tiptap-markdown's storage it doesn't declare in its types.
 * `parse` returns HTML, which is how the extension feeds `setContent`.
 */
type MarkdownIt = InlineProbe & {
  use: (plugin: unknown, ...params: unknown[]) => MarkdownIt
}
type MarkdownInternals = {
  parser: { md: MarkdownIt; parse: (content: string) => string }
  serializer: { serialize: (content: ProseMirrorNode) => string }
}

const internals = (editor: Editor): MarkdownInternals =>
  (editor.storage as unknown as { markdown: MarkdownInternals }).markdown

/** The markdown-it instance the editor loads files with, for escape probing. */
export const getInlineProbe = (editor: Editor): InlineProbe | null => {
  try {
    return internals(editor).parser.md ?? null
  } catch {
    return null
  }
}

const STABILIZED = Symbol('smarkup.parser-stabilized')

/**
 * tiptap-markdown re-runs every extension's markdown-it `parse.setup` hook on
 * *every* parse, and one of them registers a plugin with `md.use`. Parsing
 * used to happen only on load, so the duplicate registrations stayed
 * invisible; verification parses on every edit, which would grow markdown-it's
 * rule chain without bound. Make registration idempotent.
 */
export const stabilizeParser = (editor: Editor): void => {
  const md = internals(editor)?.parser?.md as (MarkdownIt & { [STABILIZED]?: true }) | undefined
  if (!md || md[STABILIZED]) return
  const registered = new Set<unknown>()
  const register = md.use.bind(md)
  md.use = (plugin, ...params) => {
    if (registered.has(plugin)) return md
    registered.add(plugin)
    return register(plugin, ...params)
  }
  md[STABILIZED] = true
}

const render = (editor: Editor, doc: ProseMirrorNode): string =>
  unescapeVariables(internals(editor).serializer.serialize(doc))

/** Render with redundant escapes suppressed — the normal path. */
export const serializeMarkdown = (editor: Editor, doc: ProseMirrorNode): string =>
  withMinimalEscaping(() => render(editor, doc))

/** Render escaping everything that could be markup — the safe fallback. */
const serializeMarkdownStrict = (editor: Editor, doc: ProseMirrorNode): string =>
  render(editor, doc)

/** Read markdown back into a document, exactly as loading a file does. */
export const parseMarkdown = (editor: Editor, markdown: string): ProseMirrorNode => {
  const html = internals(editor).parser.parse(markdown)
  const body = new window.DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  return ProseMirrorDOMParser.fromSchema(editor.schema).parse(body, editor.options.parseOptions)
}

/** True when `markdown` reads back as a document that renders to `expected`. */
const rendersBackTo = (editor: Editor, markdown: string, expected: string): boolean => {
  try {
    return serializeMarkdown(editor, parseMarkdown(editor, markdown)) === expected
  } catch {
    return false
  }
}

export type Reconciled = {
  /** What to write to the buffer. */
  text: string
  /** Its rendering, to carry forward as the baseline for the next edit. */
  markdown: string
}

/**
 * Turn the current document into the smallest possible change to `baseSource`.
 *
 * `baseMarkdown` is what this document rendered to when `baseSource` was
 * loaded — null before the first render, in which case there's nothing to
 * rebase onto and the rendering is used as-is.
 */
export const reconcileMarkdown = (
  editor: Editor,
  baseSource: string,
  baseMarkdown: string | null
): Reconciled => {
  const doc = editor.state.doc
  const next = serializeMarkdown(editor, doc)

  // Same rendering as when the file loaded: the document didn't change, so
  // the file mustn't either. This is the case that makes opening a file, or
  // flipping between raw and visual, a no-op on disk.
  if (next === baseMarkdown) return { text: baseSource, markdown: baseMarkdown }

  if (baseMarkdown !== null) {
    try {
      const merged = rebaseOntoSource(baseSource, baseMarkdown, next)
      if (merged !== null && merged !== next && rendersBackTo(editor, merged, next)) {
        return { text: merged, markdown: next }
      }
    } catch {
      // A merge that throws is a merge we don't use.
    }
  }

  // Nothing to rebase onto, or the rebase couldn't be proven. Write the
  // rendering — but only once it has survived its own round-trip, so a
  // skipped escape can't quietly change what the file says.
  if (rendersBackTo(editor, next, next)) return { text: next, markdown: next }
  return { text: serializeMarkdownStrict(editor, doc), markdown: next }
}
