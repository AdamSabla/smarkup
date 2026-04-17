/**
 * Editor-agnostic search interface for the FindBar.
 *
 * The FindBar component speaks `SearchAdapter`; concrete adapters wrap either
 * a CodeMirror 6 view (raw editor) or a Tiptap editor (visual editor).
 *
 * State lives in the underlying editor (CM's search field, our PM plugin) —
 * the adapter is a thin imperative facade. `setQuery` drives highlighting and
 * jumps the selection to the first match; `next`/`prev` cycle through; the
 * returned `MatchInfo` lets the bar render "3 / 17".
 */

export type MatchInfo = {
  /** Total matches in the document. */
  count: number
  /** 1-indexed position of the current match (0 if no matches). */
  current: number
}

export type SearchAdapter = {
  /** Set or clear the search query. Empty string clears highlights. */
  setQuery: (query: string) => MatchInfo
  /** Move to the next match (wraps). */
  next: () => MatchInfo
  /** Move to the previous match (wraps). */
  prev: () => MatchInfo
  /** Replace the currently-selected match, then advance to the next. */
  replace: (replacement: string) => MatchInfo
  /** Replace every match in the document. Returns how many were replaced. */
  replaceAll: (replacement: string) => { replaced: number }
  /** Clear all match highlighting (called when the bar closes). */
  clear: () => void
}

// ----------------------------------------------------------------------------
// CodeMirror 6 adapter (raw editor)
// ----------------------------------------------------------------------------

import type { EditorView } from '@codemirror/view'
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll as cmReplaceAll,
  SearchCursor
} from '@codemirror/search'
import { EditorSelection } from '@codemirror/state'

/**
 * Walk the doc with a fresh SearchCursor and return count + 1-based index of
 * the match whose `from` matches the current selection (i.e. the one CM just
 * navigated to). CM's search field doesn't expose count/index, so we compute
 * on demand — cheap for any realistic markdown document.
 */
const countCMMatches = (view: EditorView, query: string): MatchInfo => {
  if (!query) return { count: 0, current: 0 }
  const cursor = new SearchCursor(view.state.doc, query, 0, view.state.doc.length, (s) =>
    s.toLowerCase()
  )
  const selFrom = view.state.selection.main.from
  let count = 0
  let current = 0
  while (!cursor.next().done) {
    count += 1
    if (current === 0 && cursor.value.from === selFrom) current = count
  }
  return { count, current }
}

export const createCMSearchAdapter = (view: EditorView): SearchAdapter => {
  let query = ''

  return {
    setQuery: (q) => {
      query = q
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({ search: q, caseSensitive: false, regexp: false })
        )
      })
      if (!q) return { count: 0, current: 0 }
      findNext(view)
      return countCMMatches(view, q)
    },
    next: () => {
      if (!query) return { count: 0, current: 0 }
      findNext(view)
      return countCMMatches(view, query)
    },
    prev: () => {
      if (!query) return { count: 0, current: 0 }
      findPrevious(view)
      return countCMMatches(view, query)
    },
    replace: (replacement) => {
      if (!query) return { count: 0, current: 0 }
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({ search: query, replace: replacement, caseSensitive: false })
        )
      })
      replaceNext(view)
      return countCMMatches(view, query)
    },
    replaceAll: (replacement) => {
      if (!query) return { replaced: 0 }
      // Count first — after replaceAll runs, matches are gone.
      const before = countCMMatches(view, query).count
      view.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({ search: query, replace: replacement, caseSensitive: false })
        )
      })
      cmReplaceAll(view)
      return { replaced: before }
    },
    clear: () => {
      query = ''
      view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: '' }))
      })
      // Collapse the lingering match-selection so the cursor isn't parked on
      // the last found range once the bar closes.
      const head = view.state.selection.main.head
      view.dispatch({ selection: EditorSelection.cursor(head) })
    }
  }
}

// ----------------------------------------------------------------------------
// Tiptap adapter (visual editor)
// ----------------------------------------------------------------------------

import type { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { searchHighlightKey, type SearchMatch } from '@/extensions/search-highlight'

/**
 * Read the plugin's current match list + current index as `MatchInfo`.
 */
const readTiptapInfo = (editor: Editor): MatchInfo => {
  const s = searchHighlightKey.getState(editor.state)
  if (!s || s.matches.length === 0) return { count: 0, current: 0 }
  return { count: s.matches.length, current: s.currentIndex + 1 }
}

export const createTiptapSearchAdapter = (editor: Editor): SearchAdapter => {
  const applyAndReadAfter = (
    meta: unknown,
    computeMatch: (after: ReturnType<typeof searchHighlightKey.getState>) => SearchMatch | null
  ): MatchInfo => {
    // We need to know which match to jump to. Compute it speculatively by
    // asking the plugin's reducer what the new state looks like — simplest
    // is to dispatch first, then re-read + re-dispatch a selection tr.
    editor.view.dispatch(editor.view.state.tr.setMeta(searchHighlightKey, meta))
    const after = searchHighlightKey.getState(editor.view.state)
    const target = computeMatch(after)
    if (target) {
      const { state, dispatch } = editor.view
      const from = Math.min(target.from, state.doc.content.size)
      const to = Math.min(target.to, state.doc.content.size)
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)).scrollIntoView())
    }
    return readTiptapInfo(editor)
  }

  return {
    setQuery: (query) =>
      applyAndReadAfter({ type: 'setQuery', query }, (after) =>
        after && after.matches.length > 0 ? after.matches[after.currentIndex] : null
      ),
    next: () =>
      applyAndReadAfter({ type: 'advance', delta: 1 }, (after) =>
        after && after.matches.length > 0 ? after.matches[after.currentIndex] : null
      ),
    prev: () =>
      applyAndReadAfter({ type: 'advance', delta: -1 }, (after) =>
        after && after.matches.length > 0 ? after.matches[after.currentIndex] : null
      ),
    replace: (replacement) => {
      const s = searchHighlightKey.getState(editor.view.state)
      if (!s || s.matches.length === 0) return { count: 0, current: 0 }
      const m = s.matches[s.currentIndex]
      // Replace the current match. The plugin's `apply` re-walks on docChanged
      // and clamps currentIndex — so after this, currentIndex points at what
      // used to be the *next* match (shifted down by one slot).
      const tr = editor.view.state.tr.insertText(replacement, m.from, m.to)
      editor.view.dispatch(tr)
      const after = searchHighlightKey.getState(editor.view.state)
      if (after && after.matches.length > 0) {
        const target = after.matches[after.currentIndex]
        const { state, dispatch } = editor.view
        dispatch(
          state.tr
            .setSelection(TextSelection.create(state.doc, target.from, target.to))
            .scrollIntoView()
        )
      }
      return readTiptapInfo(editor)
    },
    replaceAll: (replacement) => {
      const s = searchHighlightKey.getState(editor.view.state)
      if (!s || s.matches.length === 0) return { replaced: 0 }
      const matches = s.matches.slice()
      const tr = editor.view.state.tr
      // Apply bottom-up so earlier replacements don't shift later ranges.
      for (let i = matches.length - 1; i >= 0; i--) {
        tr.insertText(replacement, matches[i].from, matches[i].to)
      }
      editor.view.dispatch(tr)
      return { replaced: matches.length }
    },
    clear: () => {
      editor.view.dispatch(
        editor.view.state.tr.setMeta(searchHighlightKey, { type: 'setQuery', query: '' })
      )
    }
  }
}
