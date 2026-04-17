import { diffLines, diffWordsWithSpace } from 'diff'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type CharDiff = {
  side: 'left' | 'right'
  /** Absolute character offset within the *whole document* on that side. */
  from: number
  to: number
}

export type DiffHunk =
  | { type: 'equal'; leftStart: number; leftEnd: number; rightStart: number; rightEnd: number }
  | { type: 'added'; rightStart: number; rightEnd: number; leftLine: number }
  | { type: 'removed'; leftStart: number; leftEnd: number; rightLine: number }
  | {
      type: 'changed'
      leftStart: number
      leftEnd: number
      rightStart: number
      rightEnd: number
      charDiffs: CharDiff[]
    }

export type DiffResult = {
  hunks: DiffHunk[]
  additions: number
  deletions: number
  changes: number
}

/**
 * Maps each left line to the corresponding right line (or -1 for gaps)
 * and vice-versa. Used for scroll synchronisation.
 */
export type AlignmentMap = {
  /** Index = left line number (0-based). Value = right line number or -1. */
  leftToRight: number[]
  /** Index = right line number (0-based). Value = left line number or -1. */
  rightToLeft: number[]
}

/* ------------------------------------------------------------------ */
/*  Core diff                                                          */
/* ------------------------------------------------------------------ */

export function computeDiff(leftText: string, rightText: string): DiffResult {
  const changes = diffLines(leftText, rightText)

  const hunks: DiffHunk[] = []
  let leftLine = 0
  let rightLine = 0
  let additions = 0
  let deletions = 0
  let changeCount = 0

  let i = 0
  while (i < changes.length) {
    const c = changes[i]
    const lines = countLines(c.value)

    if (!c.added && !c.removed) {
      // Equal
      hunks.push({
        type: 'equal',
        leftStart: leftLine,
        leftEnd: leftLine + lines,
        rightStart: rightLine,
        rightEnd: rightLine + lines,
      })
      leftLine += lines
      rightLine += lines
      i++
      continue
    }

    // Look ahead for a removed+added pair (= changed hunk)
    const next = changes[i + 1]
    if (c.removed && next?.added) {
      const removedLines = lines
      const addedLines = countLines(next.value)
      const charDiffs = computeCharDiffs(
        c.value,
        next.value,
        leftLine,
        rightLine,
        leftText,
        rightText,
      )
      hunks.push({
        type: 'changed',
        leftStart: leftLine,
        leftEnd: leftLine + removedLines,
        rightStart: rightLine,
        rightEnd: rightLine + addedLines,
        charDiffs,
      })
      changeCount++
      leftLine += removedLines
      rightLine += addedLines
      i += 2
      continue
    }

    if (c.added) {
      hunks.push({ type: 'added', rightStart: rightLine, rightEnd: rightLine + lines, leftLine })
      additions += lines
      rightLine += lines
    } else {
      hunks.push({ type: 'removed', leftStart: leftLine, leftEnd: leftLine + lines, rightLine })
      deletions += lines
      leftLine += lines
    }
    i++
  }

  return { hunks, additions, deletions, changes: changeCount }
}

/* ------------------------------------------------------------------ */
/*  Character-level diff for "changed" hunks                           */
/* ------------------------------------------------------------------ */

function computeCharDiffs(
  leftValue: string,
  rightValue: string,
  leftLineStart: number,
  rightLineStart: number,
  leftDoc: string,
  rightDoc: string,
): CharDiff[] {
  const charDiffs: CharDiff[] = []
  const wordChanges = diffWordsWithSpace(leftValue, rightValue)

  // We need absolute offsets within the full document.
  const leftBaseOffset = lineToOffset(leftDoc, leftLineStart)
  const rightBaseOffset = lineToOffset(rightDoc, rightLineStart)

  let leftPos = 0
  let rightPos = 0

  for (const wc of wordChanges) {
    const len = wc.value.length
    if (wc.removed) {
      charDiffs.push({ side: 'left', from: leftBaseOffset + leftPos, to: leftBaseOffset + leftPos + len })
      leftPos += len
    } else if (wc.added) {
      charDiffs.push({ side: 'right', from: rightBaseOffset + rightPos, to: rightBaseOffset + rightPos + len })
      rightPos += len
    } else {
      leftPos += len
      rightPos += len
    }
  }

  return charDiffs
}

/* ------------------------------------------------------------------ */
/*  Alignment map for scroll sync                                      */
/* ------------------------------------------------------------------ */

export function buildAlignmentMap(hunks: DiffHunk[], leftLineCount: number, rightLineCount: number): AlignmentMap {
  const leftToRight = new Array<number>(leftLineCount).fill(-1)
  const rightToLeft = new Array<number>(rightLineCount).fill(-1)

  for (const h of hunks) {
    if (h.type === 'equal') {
      for (let i = 0; i < h.leftEnd - h.leftStart; i++) {
        const l = h.leftStart + i
        const r = h.rightStart + i
        if (l < leftLineCount) leftToRight[l] = r
        if (r < rightLineCount) rightToLeft[r] = l
      }
    } else if (h.type === 'changed') {
      // Map first lines of changed hunks to each other for rough alignment
      if (h.leftStart < leftLineCount) leftToRight[h.leftStart] = h.rightStart
      if (h.rightStart < rightLineCount) rightToLeft[h.rightStart] = h.leftStart
    }
  }

  // Fill gaps by interpolating from nearest mapped line
  fillGaps(leftToRight)
  fillGaps(rightToLeft)

  return { leftToRight, rightToLeft }
}

function fillGaps(arr: number[]): void {
  let lastMapped = -1
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== -1) {
      lastMapped = arr[i]
    } else if (lastMapped !== -1) {
      arr[i] = lastMapped
    }
  }
  // Fill leading gaps backwards
  let firstMapped = -1
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== -1) {
      firstMapped = arr[i]
      break
    }
  }
  if (firstMapped !== -1) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] === -1) arr[i] = firstMapped
      else break
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function countLines(text: string): number {
  if (!text) return 0
  let count = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++
  }
  // If text doesn't end with newline, the last segment is still a line
  if (text.length > 0 && text[text.length - 1] !== '\n') count++
  return count
}

function lineToOffset(doc: string, line: number): number {
  let offset = 0
  let l = 0
  while (l < line && offset < doc.length) {
    if (doc[offset] === '\n') l++
    offset++
  }
  return offset
}
