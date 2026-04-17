import {
  EditorView,
  Decoration,
  type DecorationSet,
  gutter,
  GutterMarker,
} from '@codemirror/view'
import { StateField, StateEffect, RangeSetBuilder, RangeSet } from '@codemirror/state'
import type { DiffResult, CharDiff } from './diff-engine'

/* ------------------------------------------------------------------ */
/*  Effects                                                            */
/* ------------------------------------------------------------------ */

type SideDecorations = {
  lineRanges: Array<{ from: number; to: number; type: 'added' | 'removed' | 'changed' }>
  charRanges: CharDiff[]
}

export const setDiffDecorations = StateEffect.define<SideDecorations>()

/* ------------------------------------------------------------------ */
/*  Decoration marks                                                   */
/* ------------------------------------------------------------------ */

const addedLineDeco = Decoration.line({ class: 'cm-diff-added' })
const removedLineDeco = Decoration.line({ class: 'cm-diff-removed' })
const changedLineDeco = Decoration.line({ class: 'cm-diff-changed' })

const charAddedMark = Decoration.mark({ class: 'cm-diff-char-added' })
const charRemovedMark = Decoration.mark({ class: 'cm-diff-char-removed' })

/* ------------------------------------------------------------------ */
/*  State field — stores current line/char decorations                 */
/* ------------------------------------------------------------------ */

const diffDecoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiffDecorations)) {
        return buildDecoSet(e.value, tr.state.doc)
      }
    }
    // Map decorations through doc changes so they survive CodeMirror's
    // internal value-sync transactions (which fire after the React effect
    // pushes decorations on mount). Positions may drift by one frame until
    // the React diff recomputes and pushes fresh decorations.
    if (tr.docChanged) return decos.map(tr.changes)
    return decos
  },
  provide: (f) => EditorView.decorations.from(f),
})

function buildDecoSet(
  data: SideDecorations,
  doc: { length: number; lineAt(pos: number): { from: number; to: number }; lines: number; line(n: number): { from: number } },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()

  // Collect all decorations, then sort by from position
  const allDecos: Array<{ from: number; to: number; deco: Decoration; isLine: boolean }> = []

  // Line decorations
  for (const lr of data.lineRanges) {
    for (let line = lr.from; line < lr.to && line < doc.lines; line++) {
      const lineObj = doc.lineAt(lineStartPos(doc, line))
      const deco =
        lr.type === 'added' ? addedLineDeco : lr.type === 'removed' ? removedLineDeco : changedLineDeco
      allDecos.push({ from: lineObj.from, to: lineObj.from, deco, isLine: true })
    }
  }

  // Character decorations
  for (const cr of data.charRanges) {
    const from = Math.min(cr.from, doc.length)
    const to = Math.min(cr.to, doc.length)
    if (from < to) {
      allDecos.push({
        from,
        to,
        deco: cr.side === 'left' ? charRemovedMark : charAddedMark,
        isLine: false,
      })
    }
  }

  // Sort: line decos first (they use from only), then marks sorted by from,to
  allDecos.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from
    // Line decorations before marks at same position
    if (a.isLine !== b.isLine) return a.isLine ? -1 : 1
    return a.to - b.to
  })

  for (const d of allDecos) {
    if (d.isLine) {
      builder.add(d.from, d.from, d.deco)
    } else {
      builder.add(d.from, d.to, d.deco)
    }
  }

  return builder.finish()
}

/* ------------------------------------------------------------------ */
/*  Diff gutter — narrow colored strip for added/removed/changed      */
/* ------------------------------------------------------------------ */

class DiffGutterMark extends GutterMarker {
  constructor(readonly className: string) {
    super()
  }
  toDOM(): Node {
    const el = document.createElement('div')
    el.className = this.className
    return el
  }
  eq(other: GutterMarker): boolean {
    return other instanceof DiffGutterMark && this.className === other.className
  }
}

const addedGutterMark = new DiffGutterMark('cm-diff-gutter-added')
const removedGutterMark = new DiffGutterMark('cm-diff-gutter-removed')
const changedGutterMark = new DiffGutterMark('cm-diff-gutter-changed')

const diffGutterField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty
  },
  update(markers, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiffDecorations)) {
        return buildGutterSet(e.value, tr.state.doc)
      }
    }
    if (tr.docChanged) return markers.map(tr.changes)
    return markers
  },
})

function buildGutterSet(
  data: SideDecorations,
  doc: { length: number; lines: number; line(n: number): { from: number } },
): RangeSet<GutterMarker> {
  const marks: Array<{ pos: number; marker: GutterMarker }> = []

  for (const lr of data.lineRanges) {
    const marker =
      lr.type === 'added'
        ? addedGutterMark
        : lr.type === 'removed'
          ? removedGutterMark
          : changedGutterMark
    for (let line = lr.from; line < lr.to && line < doc.lines; line++) {
      marks.push({ pos: lineStartPos(doc, line), marker })
    }
  }

  marks.sort((a, b) => a.pos - b.pos)

  const builder = new RangeSetBuilder<GutterMarker>()
  for (const m of marks) {
    builder.add(m.pos, m.pos, m.marker)
  }
  return builder.finish()
}

const diffGutterExt = gutter({
  class: 'cm-diff-gutter',
  markers: (v) => v.state.field(diffGutterField),
})

/* ------------------------------------------------------------------ */
/*  Helper                                                             */
/* ------------------------------------------------------------------ */

/** Get the start position of a 0-based line number. */
function lineStartPos(
  doc: { line(n: number): { from: number }; lines: number; length: number },
  line: number,
): number {
  // CodeMirror lines are 1-based
  if (line <= 0) return 0
  try {
    return doc.line(line + 1).from
  } catch {
    return doc.length
  }
}

/* ------------------------------------------------------------------ */
/*  Theme                                                              */
/* ------------------------------------------------------------------ */

const diffTheme = EditorView.baseTheme({
  // Line backgrounds
  '.cm-diff-added': { backgroundColor: 'rgba(34, 197, 94, 0.13)' },
  '.cm-diff-removed': { backgroundColor: 'rgba(239, 68, 68, 0.13)' },
  '.cm-diff-changed': { backgroundColor: 'rgba(234, 179, 8, 0.10)' },
  // Character-level highlights
  '.cm-diff-char-added': {
    backgroundColor: 'rgba(34, 197, 94, 0.35)',
    borderRadius: '2px',
  },
  '.cm-diff-char-removed': {
    backgroundColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: '2px',
  },
  // Diff gutter strip (narrow colored bar on the far left)
  '.cm-diff-gutter': {
    width: '3px',
    minWidth: '3px',
  },
  '.cm-diff-gutter .cm-gutterElement': {
    padding: '0 !important',
  },
  '.cm-diff-gutter .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--foreground) 40%, transparent)',
  },
  '.cm-diff-gutter-added': {
    width: '3px',
    height: '100%',
    backgroundColor: 'rgba(34, 197, 94, 0.7)',
  },
  '.cm-diff-gutter-removed': {
    width: '3px',
    height: '100%',
    backgroundColor: 'rgba(239, 68, 68, 0.7)',
  },
  '.cm-diff-gutter-changed': {
    width: '3px',
    height: '100%',
    backgroundColor: 'rgba(234, 179, 8, 0.7)',
  },
})

/* ------------------------------------------------------------------ */
/*  Public factory                                                     */
/* ------------------------------------------------------------------ */

export function createDiffExtension() {
  return [diffDecoField, diffGutterField, diffGutterExt, diffTheme]
}

/* ------------------------------------------------------------------ */
/*  Helper: build SideDecorations from a DiffResult for one side       */
/* ------------------------------------------------------------------ */

export function buildSideDecorations(diff: DiffResult, side: 'left' | 'right'): SideDecorations {
  const lineRanges: SideDecorations['lineRanges'] = []
  const charRanges: CharDiff[] = []

  for (const h of diff.hunks) {
    switch (h.type) {
      case 'added':
        if (side === 'right') {
          lineRanges.push({ from: h.rightStart, to: h.rightEnd, type: 'added' })
        }
        break
      case 'removed':
        if (side === 'left') {
          lineRanges.push({ from: h.leftStart, to: h.leftEnd, type: 'removed' })
        }
        break
      case 'changed':
        if (side === 'left') {
          lineRanges.push({ from: h.leftStart, to: h.leftEnd, type: 'changed' })
          for (const cd of h.charDiffs) {
            if (cd.side === 'left') charRanges.push(cd)
          }
        } else {
          lineRanges.push({ from: h.rightStart, to: h.rightEnd, type: 'changed' })
          for (const cd of h.charDiffs) {
            if (cd.side === 'right') charRanges.push(cd)
          }
        }
        break
    }
  }

  return { lineRanges, charRanges }
}
