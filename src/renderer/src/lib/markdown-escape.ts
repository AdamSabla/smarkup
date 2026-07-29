/**
 * Minimal markdown escaping for the visual editor's serializer.
 *
 * prosemirror-markdown escapes every character that *could* be markup —
 * `` ` ``, `*`, `~`, `[`, `]`, `_`, `\` — without asking whether it would
 * actually be read as markup where it sits. For prose that is invisible; for
 * files that are program source it is corruption. `highlights[]` comes back
 * as `highlights\[\]`, `{{> _shared/x }}` as `{{> \_shared/x }}`, `~11` as
 * `\~11`, and the literal backslash reaches whatever consumes the file.
 *
 * The rule here is the inverse: escape a character only when leaving it alone
 * would change what the text parses back into. That question has an exact
 * answer, so we ask markdown-it rather than guess — run the line through the
 * same inline parser the editor loads files with, and if it comes back as one
 * flat run of text identical to the input, nothing in it was markup and it can
 * be written verbatim. Anything else falls through to the library's escaping,
 * unchanged from before.
 *
 * Line-start syntax (`#`, `- `, `> `, `1. `) is a block-level question that an
 * inline parse can't answer, so lines that open with it always take the
 * conservative path.
 */

/** The slice of `MarkdownSerializerState` a text serializer actually touches. */
export type MarkdownWriter = {
  text: (text: string, escape?: boolean) => void
}

/** The slice of a markdown-it instance we use to probe a line. */
export type InlineProbe = {
  parseInline: (
    src: string,
    env: Record<string, unknown>
  ) => Array<{ children?: Array<{ type: string; content: string }> | null }>
}

/**
 * Characters prosemirror-markdown escapes unconditionally. A line without any
 * of them is written the same way either way, so it never needs a probe.
 */
const ESCAPABLE = /[`*\\~[\]_]/

/**
 * Anything that could open a block when it starts a line. Broader than the set
 * prosemirror-markdown escapes (which is `+ `, `-`, `*`, `>`, `#`, `1.`) so a
 * setext underline or a `)`-delimited ordered list can't slip through
 * unescaped either. Lines matching this always take the library's own path,
 * which escapes them only when the writer really is at a block start.
 */
const BLOCK_OPENER = /^\s{0,3}(?:#{1,6}(?:\s|$)|[-*+>]|\d{1,9}[.)](?:\s|$)|={2,}\s*$|~{3,}|`{3,})/

/** Bounded memo — the same lines are re-serialized on every keystroke. */
const inertCache = new Map<string, boolean>()
const INERT_CACHE_MAX = 4000

/**
 * True when `line` contains no markup at all: the inline parser reduces it to
 * a single run of plain text byte-identical to the input, and it doesn't open
 * a block. Such a line survives a write → read round-trip unescaped.
 */
const isInert = (line: string, probe: InlineProbe): boolean => {
  const cached = inertCache.get(line)
  if (cached !== undefined) return cached

  let inert = false
  try {
    if (!BLOCK_OPENER.test(line)) {
      const children = probe.parseInline(line, {})[0]?.children
      if (children) {
        let flattened = ''
        inert = true
        for (const token of children) {
          if (token.type !== 'text') {
            inert = false
            break
          }
          flattened += token.content
        }
        // `text` tokens carry the *resolved* content, so an entity or a
        // backslash escape in the source shows up here as a mismatch.
        if (inert && flattened !== line) inert = false
      }
    }
  } catch {
    // A probe that throws tells us nothing — escape as before.
    inert = false
  }

  if (inertCache.size >= INERT_CACHE_MAX) inertCache.clear()
  inertCache.set(line, inert)
  return inert
}

/**
 * Whether serialization is currently allowed to skip redundant escapes.
 *
 * Module-level because the decision is made per *serialization pass* but acted
 * on deep inside prosemirror-markdown, in a text-node callback that has no way
 * to receive it. Every pass is synchronous, so the flag can never be observed
 * by an unrelated one. `reconcileMarkdown` uses the strict pass as its
 * last-resort fallback when the minimal one can't be proven faithful.
 */
let minimalEscaping = false

/** Run `fn` with redundant-escape suppression enabled. */
export const withMinimalEscaping = <T>(fn: () => T): T => {
  const previous = minimalEscaping
  minimalEscaping = true
  try {
    return fn()
  } finally {
    minimalEscaping = previous
  }
}

/**
 * Write a text node to the markdown serializer, escaping only what has to be
 * escaped. Drop-in for `state.text(node.text)`, and identical to it whenever
 * `withMinimalEscaping` is not in effect.
 *
 * Written line by line because escaping is a per-line question — the writer's
 * own block-start tracking advances between them.
 */
export const writeText = (state: MarkdownWriter, text: string, probe: InlineProbe | null): void => {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) state.text('\n', false)
    const line = lines[i]
    const verbatim =
      minimalEscaping && probe !== null && ESCAPABLE.test(line) && isInert(line, probe)
    state.text(line, !verbatim)
  }
}
