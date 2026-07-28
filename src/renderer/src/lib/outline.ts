import { countWords } from '@/lib/text-stats'

/**
 * A heading and everything under it, up to the next heading of any level.
 *
 * `raw` is the exact source slice — heading line included — so reassembling
 * the sections in their original order reproduces the file byte for byte.
 * Descendants are NOT nested here: the list is flat and in document order,
 * and parentage is implied by `level`, the same way markdown implies it.
 */
export type OutlineSection = {
  /** Stable identity for the lifetime of one dialog session (original index). */
  id: number
  level: number
  title: string
  raw: string
  /** Words in this section alone — descendants are counted separately. */
  words: number
  /**
   * Partial imports (`{{> _shared/market-conventions}}`) found in this
   * section's body. Deliberately not outline nodes of their own: a partial
   * sits mid-paragraph as often as not, so promoting it to a row would mean
   * splitting prose that belongs together. It travels with its section, so
   * the outline reports it as a property of the row instead.
   */
  partials: string[]
}

export type Outline = {
  /**
   * Everything before the first heading. The only content that can't belong
   * to a section, and by definition it can only ever be at the top.
   */
  preamble: string
  preambleWords: number
  preamblePartials: string[]
  sections: OutlineSection[]
}

/** `{{> path/to/partial}}` — the import form, not plain `{{variable}}`
 *  substitution, which doesn't pull in content the outline should flag. */
const PARTIAL_RE = /\{\{>\s*([^}]+?)\s*\}\}/g

const partialsIn = (text: string): string[] => {
  const out: string[] = []
  PARTIAL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PARTIAL_RE.exec(text))) out.push(m[1].replace(/\\/g, ''))
  return out
}

/** One reordered entry: which section, and what level it should become. */
export type OutlineMove = { id: number; level: number }

const ATX_RE = /^(#{1,6})[ \t]+(.*)$/
const FENCE_RE = /^\s*(```|~~~)/

/**
 * Split markdown into its preamble and a flat list of heading sections.
 *
 * Only ATX headings (`## Title`) are recognised — that's what the app's own
 * serializer emits. Setext headings in a hand-written file are left as body
 * text, which means they don't show up in the outline but also can't be
 * damaged by it. `#` inside fenced code blocks is skipped.
 */
export const parseOutline = (content: string): Outline => {
  const lines = content.split('\n')
  /** Byte offset of the start of each line. */
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }

  const heads: { line: number; level: number; title: string }[] = []
  let fence: string | null = null
  lines.forEach((line, i) => {
    const f = FENCE_RE.exec(line)
    if (f) {
      if (!fence) fence = f[1]
      else if (line.trim().startsWith(fence)) fence = null
      return
    }
    if (fence) return
    const m = ATX_RE.exec(line)
    if (!m) return
    heads.push({
      line: i,
      level: m[1].length,
      // Closed ATX (`## Title ##`) — drop the trailing hashes.
      title: m[2].replace(/\s+#+\s*$/, '').trim() || 'Untitled'
    })
  })

  const firstStart = heads.length > 0 ? starts[heads[0].line] : content.length
  const sections: OutlineSection[] = heads.map((h, i) => {
    const from = starts[h.line]
    const to = i + 1 < heads.length ? starts[heads[i + 1].line] : content.length
    const raw = content.slice(from, to)
    return {
      id: i,
      level: h.level,
      title: h.title,
      raw,
      words: countWords(raw),
      partials: partialsIn(raw)
    }
  })

  const preamble = content.slice(0, firstStart)
  return {
    preamble,
    preambleWords: countWords(preamble),
    preamblePartials: partialsIn(preamble),
    sections
  }
}

/** Rewrite a section's heading line to a new level, leaving its body alone. */
const atLevel = (raw: string, level: number): string =>
  raw.replace(ATX_RE, (_m, _hashes: string, rest: string) => `${'#'.repeat(level)} ${rest}`)

/**
 * Rebuild the document from a reordered list of sections.
 *
 * Returns the original content unchanged when the moves describe the order
 * the file is already in, so an untouched dialog can't dirty the buffer.
 */
export const applyOutline = (content: string, moves: OutlineMove[]): string => {
  const { preamble, sections } = parseOutline(content)
  const byId = new Map(sections.map((s) => [s.id, s]))
  const parts = moves.map((m) => {
    const s = byId.get(m.id)
    if (!s) return ''
    return s.level === m.level ? s.raw : atLevel(s.raw, m.level)
  })
  const next = preamble + parts.join('')
  return next === content ? content : next
}

/** Number of sections nested under `index` (its whole subtree). */
export const descendantCount = (sections: { level: number }[], index: number): number => {
  const level = sections[index].level
  let i = index + 1
  while (i < sections.length && sections[i].level > level) i++
  return i - index - 1
}

/** Words in a section including everything nested under it. */
export const subtreeWords = (sections: OutlineSection[], index: number): number => {
  const n = descendantCount(sections, index)
  let total = 0
  for (let i = index; i <= index + n; i++) total += sections[i].words
  return total
}

/**
 * Deepest level a section may legally take at `index` — one deeper than the
 * row above it, so the document can never jump from H2 straight to H4.
 */
export const maxLevelAt = (sections: { level: number }[], index: number): number =>
  index > 0 ? Math.min(sections[index - 1].level + 1, 6) : 1
