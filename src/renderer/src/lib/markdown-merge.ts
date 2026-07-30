import { diffArrays } from 'diff'

/**
 * Re-express a freshly serialized document as an edit of the original file.
 *
 * The visual editor round-trips through a document model, so what it writes
 * back is a *rendering* of that model: blank-line runs collapsed to one,
 * `*` bullets rewritten as `-`, `1)` as `1.`, table columns re-padded, setext
 * headings turned into `#`. None of that is a change the user made, but all of
 * it lands in the file — one edited word shows up as a rewritten document.
 *
 * So don't write the rendering. Treat it as a three-way merge instead:
 *
 *   base   — the file's own rendering, taken the moment it was loaded and
 *            before any edit
 *   ours   — the file, byte for byte
 *   theirs — the rendering after the edit
 *
 * `ours` and `theirs` are two independent revisions of `base`: one carries the
 * file's formatting, the other the user's change. Merging keeps both. Regions
 * the edit didn't touch come back as the original bytes; only the region it
 * did touch is taken from the new rendering.
 *
 * The result is a *candidate*. Splicing text can't know it landed on a block
 * boundary, so the caller proves the merge by re-parsing it and comparing the
 * result against `theirs` before letting it reach the file.
 */
export const rebaseOntoSource = (source: string, base: string, next: string): string | null => {
  const ours = toBlocks(source)
  const baseBlocks = toBlocks(base)
  const theirs = toBlocks(next)

  const bounds = alignToSource(baseBlocks, ours)
  if (!bounds) return null

  // Both sides here came out of the same serializer, so compare them
  // literally — a difference is the user's edit, not a rendering artifact.
  const edits = orderRemovalsFirst(
    diffArrays(baseBlocks, theirs, { comparator: (a, b) => a.text === b.text })
  )

  const merged: string[] = []
  let cursor = 0
  let baseIndex = 0
  /** The original of whatever the next addition is replacing, if it replaces one. */
  let replaced: Block[] = []
  for (const part of edits) {
    if (part.added) {
      // The edit itself — the one place the new rendering reaches the file.
      part.value.forEach((block, i) => merged.push(...relist(replaced[i], block)))
      replaced = []
      continue
    }
    baseIndex += part.value.length
    const stop = bounds[baseIndex - 1]
    // Untouched by the edit: replay the original bytes. Dropped by it: hold on
    // to the bytes anyway, in case an addition follows and is its rewrite.
    if (part.removed) replaced = ours.slice(cursor, stop)
    else {
      for (let i = cursor; i < stop; i++) merged.push(...ours[i].lines)
      replaced = []
    }
    cursor = stop
  }
  for (let i = cursor; i < ours.length; i++) merged.push(...ours[i].lines)

  return merged.join('\n')
}

/** A list item's own marker: indent, then a bullet or a delimited number. */
const LIST_MARKER = /^(\s*)(?:([-*+])|(\d{1,9})([.)]))(\s+)/

/**
 * Give a rewritten block back the list marker the file was using.
 *
 * The rendering writes every bullet as `-` and every ordered item as `1.`, so
 * an edited item comes back spelled differently from the siblings it is still
 * sitting between. That is worse than cosmetic: `- a` next to `* b` is two
 * lists, not one, and the caller's re-parse check will (rightly) throw the
 * whole merge away and fall back to rewriting the file. Restoring the marker
 * keeps the list a list. The number itself stays as rendered — renumbering is
 * something the document model is entitled to have an opinion about.
 */
const relist = (source: Block | undefined, rewritten: Block): string[] => {
  if (!source || source.lines.length !== 1 || rewritten.lines.length !== 1) return rewritten.lines
  const from = LIST_MARKER.exec(source.lines[0])
  const to = LIST_MARKER.exec(rewritten.lines[0])
  // Only swap like for like: a bullet that stayed a bullet, a number that
  // stayed a number. A list the user changed the *kind* of is a real edit.
  if (!from || !to || !from[2] !== !to[2]) return rewritten.lines
  const marker = from[2] ?? to[3] + from[4]
  return [to[1] + marker + to[5] + rewritten.lines[0].slice(to[0].length)]
}

/**
 * One content line, or one whole run of blank lines.
 *
 * Diffing raw lines doesn't survive contact with markdown: a file full of
 * blank lines gives an LCS far too many equally-good alignments, and it will
 * happily match the blank line after one paragraph to the blank line after
 * another. Taking a blank run as a single unit fixes that, and it also means a
 * run keeps its identity — five blank lines and the one line the renderer
 * collapsed them to are the *same* block, so they line up instead of
 * registering as a change, and neither the block above nor the one below drags
 * them along when it is edited.
 */
type Block = {
  /** Comparison key, normalized past the differences a rendering introduces. */
  key: string
  /** Exact text, for comparing two renderings against each other. */
  text: string
  lines: string[]
}

const toBlocks = (source: string): Block[] => {
  const blocks: Block[] = []
  let inBlankRun = false
  for (const line of source.split('\n')) {
    const blank = line.trim() === ''
    if (blank && inBlankRun) blocks[blocks.length - 1].lines.push(line)
    // Every blank run keys as the empty string, so runs of different lengths
    // still match each other. No content line can key that way.
    else blocks.push({ key: blank ? '' : normalize(line), text: '', lines: [line] })
    inBlankRun = blank
  }
  for (const block of blocks) block.text = block.lines.join('\n')
  return blocks
}

/**
 * Strip the differences that are the renderer's doing rather than the
 * author's, so a block still matches its original after being re-emitted.
 * Used only to line the file up against its own rendering — never to decide
 * whether the *user* changed something.
 */
const normalize = (line: string): string =>
  line
    .replace(/\\([^\p{L}\p{N}\s])/gu, '$1')
    .replace(/^(\s*)[*+-](\s)/, '$1-$2')
    .replace(/^(\s*\d{1,9})[.)](\s)/, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * For each base block, the index in `ours` just past the source it stands for
 * — including any blocks `ours` has that the rendering dropped, so they travel
 * with the block they follow instead of being stranded.
 */
const alignToSource = (baseBlocks: Block[], ours: Block[]): number[] | null => {
  const bounds = new Array<number>(baseBlocks.length)
  let baseIndex = 0
  let ourIndex = 0
  const parts = orderRemovalsFirst(
    diffArrays(baseBlocks, ours, { comparator: (a, b) => a.key === b.key })
  )
  for (const part of parts) {
    const count = part.value.length
    if (part.added) {
      ourIndex += count
      // Attach to the base block just above — after reordering, that is the
      // last block of the removal this addition replaces, when there was one.
      if (baseIndex > 0) bounds[baseIndex - 1] = ourIndex
    } else if (part.removed) {
      for (let i = 0; i < count; i++) bounds[baseIndex++] = ourIndex
    } else {
      for (let i = 0; i < count; i++) bounds[baseIndex++] = ++ourIndex
    }
  }
  // A short walk means the diff disagrees with us about `base`; bail rather
  // than splice against indices we don't trust.
  return baseIndex === baseBlocks.length ? bounds : null
}

/**
 * jsdiff reports a replacement as the addition first and the removal second.
 * Everything downstream reads a change region as "what left, then what
 * arrived", so put the parts in that order.
 */
type Part = { value: Block[]; added?: boolean; removed?: boolean }
const orderRemovalsFirst = (parts: Part[]): Part[] => {
  const ordered = parts.slice()
  for (let i = 0; i + 1 < ordered.length; i++) {
    if (ordered[i].added && ordered[i + 1].removed) {
      ;[ordered[i], ordered[i + 1]] = [ordered[i + 1], ordered[i]]
    }
  }
  return ordered
}
