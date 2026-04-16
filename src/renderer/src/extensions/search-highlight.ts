import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Visual-editor search backend for the FindBar.
 *
 * Holds:
 *   - the current query string
 *   - a flat list of every match in the doc (position pairs)
 *   - the index of the "current" match (the one the user has navigated to)
 *   - decorations: every match gets `.smarkup-search-match`, the current one
 *     also gets `.smarkup-search-match-current` for stronger highlighting
 *
 * Driven entirely by meta transactions:
 *   - { type: 'setQuery', query } — set/clear query and rebuild matches
 *   - { type: 'advance', delta } — move currentIndex by ±1 (wraps)
 *   - { type: 'recompute' }      — re-walk doc (after replace) and clamp index
 *
 * The adapter in `lib/search-adapter.ts` reads/writes via these messages and
 * never touches the plugin internals directly.
 */

export type SearchMatch = { from: number; to: number }

export type SearchHighlightState = {
  query: string
  matches: SearchMatch[]
  currentIndex: number
  decorations: DecorationSet
}

export const searchHighlightKey = new PluginKey<SearchHighlightState>('search-highlight')

const EMPTY_STATE = (): SearchHighlightState => ({
  query: '',
  matches: [],
  currentIndex: 0,
  decorations: DecorationSet.empty
})

/**
 * Walk every text node in the doc and collect match ranges. Case-insensitive,
 * literal substring (no regex) — Chrome's find behavior. Empty query → no
 * matches.
 */
export const buildMatches = (doc: PMNode, query: string): SearchMatch[] => {
  if (!query) return []
  const needle = query.toLowerCase()
  const matches: SearchMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const haystack = node.text.toLowerCase()
    let idx = 0
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
      const from = pos + idx
      matches.push({ from, to: from + needle.length })
      idx += needle.length
    }
    return false
  })
  return matches
}

/** Build the DecorationSet against a known doc. */
const decorationsFor = (
  doc: PMNode,
  matches: SearchMatch[],
  currentIndex: number
): DecorationSet => {
  if (matches.length === 0) return DecorationSet.empty
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class:
        i === currentIndex
          ? 'smarkup-search-match smarkup-search-match-current'
          : 'smarkup-search-match'
    })
  )
  return DecorationSet.create(doc, decos)
}

type Meta =
  | { type: 'setQuery'; query: string }
  | { type: 'advance'; delta: 1 | -1 }
  | { type: 'recompute' }

export const SearchHighlighter = Extension.create({
  name: 'searchHighlighter',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchHighlightState>({
        key: searchHighlightKey,
        state: {
          init: () => EMPTY_STATE(),
          apply: (tr: Transaction, prev: SearchHighlightState): SearchHighlightState => {
            const meta = tr.getMeta(searchHighlightKey) as Meta | undefined

            if (meta?.type === 'setQuery') {
              const matches = buildMatches(tr.doc, meta.query)
              return {
                query: meta.query,
                matches,
                currentIndex: 0,
                decorations: decorationsFor(tr.doc, matches, 0)
              }
            }

            if (meta?.type === 'advance' && prev.matches.length > 0) {
              const len = prev.matches.length
              const next = (prev.currentIndex + meta.delta + len) % len
              return {
                ...prev,
                currentIndex: next,
                decorations: decorationsFor(tr.doc, prev.matches, next)
              }
            }

            if (meta?.type === 'recompute' || tr.docChanged) {
              if (!prev.query) {
                // No active query, but doc changed — just remap the (empty) deco set.
                return { ...prev, decorations: prev.decorations.map(tr.mapping, tr.doc) }
              }
              const matches = buildMatches(tr.doc, prev.query)
              // Keep the current index pinned to the same ordinal slot, but
              // clamp so it stays in range when matches shrink (e.g. after a
              // replace that consumed the last match).
              const currentIndex =
                matches.length === 0 ? 0 : Math.min(prev.currentIndex, matches.length - 1)
              return {
                query: prev.query,
                matches,
                currentIndex,
                decorations: decorationsFor(tr.doc, matches, currentIndex)
              }
            }

            return prev
          }
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations ?? DecorationSet.empty
          }
        }
      })
    ]
  }
})
