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
 * answer, so we ask markdown-it rather than guess — write a candidate, run it
 * through the same inline parser the editor loads files with, and accept it if
 * it comes back as one flat run of text identical to what we meant to say.
 *
 * Start from the candidate with no escapes at all. If it survives, nothing in
 * the line was markup and it is written verbatim. If it doesn't, add one
 * backslash — leftmost escapable character first — and ask again. Each pass
 * neutralizes whatever construct was opening earliest, so the loop converges on
 * a line carrying the few escapes it actually needs and none of the ones it
 * doesn't: `a[b](c)` needs one, not two; a literal `**bold**` needs two, not
 * four. A line that never comes back clean falls through to the library's
 * escaping, unchanged from before.
 *
 * Line-start syntax (`#`, `- `, `> `, `1. `) is a block-level question an
 * inline parse can't answer, so it is asked separately, and only for text that
 * really is starting a block — prosemirror-markdown tracks that on the
 * serializer state, and a `*` in the middle of a line was never a bullet.
 */

/** The slice of `MarkdownSerializerState` a text serializer actually touches. */
export type MarkdownWriter = {
  text: (text: string, escape?: boolean) => void
  /**
   * prosemirror-markdown's own "is this write starting a block?" flag, which is
   * what it passes to its escaper as `startOfLine`. Absent on a stub writer, in
   * which case assume the conservative answer.
   */
  atBlockStart?: boolean
}

/** The slice of a markdown-it instance we use to probe a line. */
export type InlineProbe = {
  parseInline: (
    src: string,
    env: Record<string, unknown>
  ) => Array<{ children?: Array<{ type: string; content: string }> | null }>
}

/** Characters prosemirror-markdown escapes unconditionally. */
const ESCAPABLE = new Set(['`', '*', '\\', '~', '[', ']', '_'])
const HAS_ESCAPABLE = /[`*\\~[\]_]/

/**
 * Anything that could open a block when it starts a line. Wider than the set
 * prosemirror-markdown escapes (`+ `, `-`, `*`, `>`, `#`, `1.`) in what it
 * covers, and narrower in what it accuses: a bullet marker is only a bullet
 * with a space after it, and a thematic break is three of the *same*
 * character, so `*args`, `+1` and ``~~` `` are prose and stay that way.
 *
 * A setext underline (`===` under a paragraph) isn't here: every block this
 * serializer writes is preceded by a blank line, so there is never a paragraph
 * above for one to attach to.
 */
const BLOCK_OPENER =
  /^(?:\s{4,}|\s{0,3}(?:#{1,6}(?:\s|$)|[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|>|([-*_])[ \t]*(?:\1[ \t]*){2,}$|~{3,}|`{3,}))/

/**
 * Backslash the one character that makes `line` open a block, leaving the rest
 * of it alone. Ordered so the more specific reading wins; a line only opens one
 * block, so the first rule that bites is the answer.
 */
const BLOCK_ESCAPES: Array<[RegExp, string]> = [
  [/^(\s{0,3})([-*+])(\s|$)/, '$1\\$2$3'],
  [/^(\s{0,3})(>)/, '$1\\$2'],
  [/^(\s{0,3})(#{1,6})(\s|$)/, '$1\\$2$3'],
  [/^(\s{0,3}\d{1,9})([.)])(\s|$)/, '$1\\$2$3'],
  [/^(\s{0,3})([-*_])([ \t]*(?:\2[ \t]*){2,})$/, '$1\\$2$3'],
  [/^(\s{0,3})(~{3,}|`{3,})/, '$1\\$2']
]

const escapeBlockOpener = (line: string): string => {
  for (const [pattern, replacement] of BLOCK_ESCAPES) {
    const escaped = line.replace(pattern, replacement)
    if (escaped !== line) return escaped
  }
  return line
}

/**
 * How many backslashes we're willing to try adding before handing the line to
 * the library. Each one costs an inline parse, and a line that needs more than
 * a handful is markup-dense enough that the library's answer is no worse.
 */
const MAX_PASSES = 12

/** Bounded memo — the same lines are re-serialized on every keystroke. */
const escapeCache = new Map<string, string | null>()
const ESCAPE_CACHE_MAX = 4000

/**
 * True when `candidate` reads back as exactly `line` and nothing else: one flat
 * run of text, no markup, no block opened. `text` tokens carry the *resolved*
 * content, so a backslash escape in the candidate shows up here as the literal
 * character it stands for — which is the whole point of the comparison.
 *
 * `inLink` probes the candidate as a link label instead of as free text, since
 * that is a different dialect: `]` ends it, and a bare URL inside it is not
 * turned into a second link. Probing `[foo_bar](url)`'s label as if it were
 * loose prose is what used to make it come back as `[foo\_bar](url)`.
 */
const reparsesToText = (
  candidate: string,
  line: string,
  probe: InlineProbe,
  atBlockStart: boolean,
  inLink: boolean
): boolean => {
  if (atBlockStart && BLOCK_OPENER.test(candidate)) return false
  try {
    const children = probe.parseInline(inLink ? `[${candidate}](#)` : candidate, {})[0]?.children
    if (!children) return false
    const first = inLink ? 1 : 0
    const last = children.length - (inLink ? 2 : 1)
    if (inLink && (children[0]?.type !== 'link_open' || children.at(-1)?.type !== 'link_close')) {
      return false
    }
    let flattened = ''
    for (let i = first; i <= last; i++) {
      if (children[i].type !== 'text') return false
      flattened += children[i].content
    }
    return flattened === line
  } catch {
    // A probe that throws tells us nothing — let the caller escape as before.
    return false
  }
}

/** Rebuild `line` with a backslash before each of the given offsets. */
const withEscapes = (line: string, offsets: number[], atBlockStart: boolean): string => {
  let out = ''
  let next = 0
  for (let i = 0; i < line.length; i++) {
    if (offsets[next] === i) {
      out += '\\'
      next++
    }
    out += line[i]
  }
  // Applied last so a leading marker that already picked up an inline escape
  // isn't escaped twice.
  return atBlockStart ? escapeBlockOpener(out) : out
}

/**
 * The least-escaped spelling of `line` that still reads back as `line`, or null
 * if there isn't one and the library should decide.
 */
const solve = (
  line: string,
  probe: InlineProbe,
  atBlockStart: boolean,
  inLink: boolean
): string | null => {
  // Nothing the library would touch: its answer is `line` too, so let it say so.
  if (!HAS_ESCAPABLE.test(line) && !(atBlockStart && BLOCK_OPENER.test(line))) return null

  const positions: number[] = []
  for (let i = 0; i < line.length; i++) if (ESCAPABLE.has(line[i])) positions.push(i)

  const passes = Math.min(positions.length, MAX_PASSES)
  for (let count = 0; count <= passes; count++) {
    let offsets = positions.slice(0, count)
    let candidate = withEscapes(line, offsets, atBlockStart)
    if (!reparsesToText(candidate, line, probe, atBlockStart, inLink)) continue

    // Adding escapes left to right stops as soon as the line is safe, which can
    // leave an innocent character escaped ahead of the guilty one — `)_>*#*`
    // only needs the `*` neutralized, but the `_` was reached first. Take each
    // one back out again and keep the removal whenever the line stays safe.
    for (let i = 0; i < offsets.length; ) {
      const fewer = offsets.slice(0, i).concat(offsets.slice(i + 1))
      const trial = withEscapes(line, fewer, atBlockStart)
      if (reparsesToText(trial, line, probe, atBlockStart, inLink)) {
        offsets = fewer
        candidate = trial
      } else i++
    }
    return candidate
  }
  return null
}

const minimalEscape = (
  line: string,
  probe: InlineProbe,
  atBlockStart: boolean,
  inLink: boolean
): string | null => {
  const key = `${atBlockStart ? 1 : 0}${inLink ? 1 : 0}${line}`
  const cached = escapeCache.get(key)
  if (cached !== undefined) return cached

  const solved = solve(line, probe, atBlockStart, inLink)
  if (escapeCache.size >= ESCAPE_CACHE_MAX) escapeCache.clear()
  escapeCache.set(key, solved)
  return solved
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
 * Written line by line because escaping is a per-line question — only the first
 * line of the node can be the one starting the block.
 *
 * `inLink` says the text is the label of a link the serializer has already
 * opened, which changes both what would be read as markup inside it and whether
 * it could be starting a block (it can't — the `[` got there first).
 */
export const writeText = (
  state: MarkdownWriter,
  text: string,
  probe: InlineProbe | null,
  inLink = false
): void => {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) state.text('\n', false)
    const line = lines[i]
    // A line after a newline inside the node is at a line start too, and an
    // absent flag means we're talking to something that isn't the real
    // serializer state — answer "yes" either way and let the probe decide.
    const atBlockStart = !inLink && (i > 0 || state.atBlockStart !== false)
    const escaped =
      minimalEscaping && probe !== null ? minimalEscape(line, probe, atBlockStart, inLink) : null
    if (escaped === null) state.text(line, true)
    else state.text(escaped, false)
  }
}
