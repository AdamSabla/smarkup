import { descendantCount, type Outline, type OutlineSection } from '@/lib/outline'

/**
 * One row of the outline UI — a heading plus the numbers we show next to it.
 *
 * `id` is the section's position in the parse the rows were built from, which
 * is what `applyOutline` addresses sections by. Reordering rows moves the ids
 * around; re-parsing renumbers them. Anything that has to survive a re-parse
 * (fold state, say) must key off something other than the id.
 */
export type OutlineRow = {
  id: number
  level: number
  title: string
  words: number
  partials: string[]
}

/** Deepest heading the visual editor can render — demoting past it would
 *  serialize as literal `#####` text on the next round trip. */
export const MAX_LEVEL = 4

/** Indent per heading level, in px. */
export const INDENT = 18

export const rowsOf = (outline: Outline): OutlineRow[] =>
  outline.sections.map((s: OutlineSection) => ({
    id: s.id,
    level: s.level,
    title: s.title,
    words: s.words,
    partials: s.partials
  }))

/** Same sections in the same order at the same levels — i.e. nothing to apply. */
export const sameRows = (a: OutlineRow[], b: OutlineRow[]): boolean =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id && r.level === b[i].level)

/** Words in a section including everything nested under it. */
export const subtreeWords = (rows: OutlineRow[], index: number): number => {
  const n = descendantCount(rows, index)
  let total = 0
  for (let i = index; i <= index + n; i++) total += rows[i].words
  return total
}

/** Partials in a section and everything nested under it — a folded row still
 *  reports the imports hiding inside it. */
export const subtreePartials = (rows: OutlineRow[], index: number): string[] => {
  const n = descendantCount(rows, index)
  const out: string[] = []
  for (let i = index; i <= index + n; i++) out.push(...rows[i].partials)
  return out
}

/** Rows that aren't hidden inside a folded ancestor, as indices into `rows`. */
export const visibleIndices = (rows: OutlineRow[], folded: Set<number>): number[] => {
  const out: number[] = []
  let hideBelow = Infinity
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].level > hideBelow) continue
    hideBelow = Infinity
    out.push(i)
    if (folded.has(rows[i].id) && descendantCount(rows, i) > 0) hideBelow = rows[i].level
  }
  return out
}

/** Rows that have something to fold — the only ones a fold set can contain. */
export const foldableRows = (rows: OutlineRow[]): OutlineRow[] =>
  rows.filter((_, i) => descendantCount(rows, i) > 0)

/**
 * Fold set that bottoms the list out at heading level `level`. Folding a row
 * hides its children, so folding every row at or below `level` is exactly
 * "show H1…H{level}".
 */
export const foldsToLevel = (rows: OutlineRow[], level: number): Set<number> =>
  new Set(
    foldableRows(rows)
      .filter((r) => r.level >= level)
      .map((r) => r.id)
  )

/**
 * Where a dragged block would land, and at what level.
 *
 * Drag decides position only: the block keeps its own level unless the
 * destination can't legally hold it (an H3 dropped where there's no H2 above
 * it), in which case it's clamped up to the deepest legal level. Nothing here
 * reads the pointer's x position — that ambiguity is what made dragging
 * fiddly, so level changes live on their own buttons instead.
 */
export const planDrop = (
  rows: OutlineRow[],
  dragIndex: number,
  gap: number
): {
  insertAt: number
  level: number
  parent: string | null
  rest: OutlineRow[]
  span: number
} => {
  const span = descendantCount(rows, dragIndex) + 1
  const rest = rows.slice(0, dragIndex).concat(rows.slice(dragIndex + span))
  const insertAt = gap > dragIndex ? gap - span : gap
  const prev = insertAt > 0 ? rest[insertAt - 1] : null
  const level = prev ? Math.min(rows[dragIndex].level, prev.level + 1) : 1
  let parent: string | null = null
  for (let i = insertAt - 1; i >= 0; i--) {
    if (rest[i].level < level) {
      parent = rest[i].title
      break
    }
  }
  return { insertAt, level, parent, rest, span }
}

/** An edit the outline can make: the new row order, a human label for it, and
 *  where the selection should land. `null` means the edit isn't legal here. */
export type OutlineEdit = { rows: OutlineRow[]; label: string; sel: number } | null

/** Apply a completed drag: the block moves, and its whole subtree shifts with
 *  it if the drop position forced a level change. */
export const dropEdit = (rows: OutlineRow[], dragIndex: number, gap: number): OutlineEdit => {
  const moved = rows[dragIndex]
  if (!moved) return null
  const { insertAt, level, rest, span } = planDrop(rows, dragIndex, gap)
  const shift = level - moved.level
  const block = rows
    .slice(dragIndex, dragIndex + span)
    .map((r) => ({ ...r, level: Math.max(1, Math.min(MAX_LEVEL, r.level + shift)) }))
  const next = rest.slice(0, insertAt).concat(block, rest.slice(insertAt))
  if (sameRows(next, rows)) return null
  return {
    rows: next,
    label: `Moved “${moved.title}”${shift ? ` · became H${level}` : ''}`,
    sel: insertAt
  }
}

/**
 * Move a section (and its subtree) past its previous or next sibling. Stops at
 * the ends of the sibling group rather than promoting out of the parent —
 * level changes stay explicit.
 */
export const moveSiblingEdit = (rows: OutlineRow[], index: number, dir: -1 | 1): OutlineEdit => {
  if (index < 0 || index >= rows.length) return null
  const level = rows[index].level
  const span = descendantCount(rows, index) + 1
  const block = rows.slice(index, index + span)
  const rest = rows.slice(0, index).concat(rows.slice(index + span))

  if (dir === -1) {
    let target = -1
    for (let i = index - 1; i >= 0; i--) {
      if (rows[i].level < level) break
      if (rows[i].level === level) {
        target = i
        break
      }
    }
    if (target < 0) return null
    return {
      rows: rest.slice(0, target).concat(block, rest.slice(target)),
      label: `Moved “${rows[index].title}” up`,
      sel: target
    }
  }

  const after = index + span
  if (after >= rows.length || rows[after].level < level) return null
  const tail = descendantCount(rows, after) + 1
  return {
    rows: rest.slice(0, index + tail).concat(block, rest.slice(index + tail)),
    label: `Moved “${rows[index].title}” down`,
    sel: index + tail
  }
}

/** Whether `shiftLevelEdit` would do anything in this direction. */
export const canShiftLevel = (rows: OutlineRow[], index: number, dir: -1 | 1): boolean => {
  const row = rows[index]
  if (!row) return false
  if (dir === -1) return row.level > 1
  return row.level < MAX_LEVEL && index > 0 && rows[index - 1].level >= row.level
}

/** Promote or demote a subtree. Demote is refused when there's no shallower
 *  heading above it to nest under. */
export const shiftLevelEdit = (rows: OutlineRow[], index: number, dir: -1 | 1): OutlineEdit => {
  if (!canShiftLevel(rows, index, dir)) return null
  const level = rows[index].level
  const span = descendantCount(rows, index) + 1
  return {
    rows: rows.map((r, i) => (i >= index && i < index + span ? { ...r, level: r.level + dir } : r)),
    label: `“${rows[index].title}” is now H${level + dir}`,
    sel: index
  }
}
