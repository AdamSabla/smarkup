import { useSyncExternalStore } from 'react'
import type { EditorView } from '@codemirror/view'

/**
 * Module-level reference to the currently mounted/focused raw (CodeMirror)
 * editor. Mirrors `active-editor.ts` for Tiptap.
 *
 * The variable navigator needs to imperatively jump the active editor to a
 * matched range; we keep the view outside zustand so transactions don't
 * ripple into React re-renders.
 */

let current: EditorView | null = null
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const l of listeners) l()
}

export const setActiveRawEditor = (view: EditorView | null): void => {
  if (current === view) return
  current = view
  emit()
}

export const getActiveRawEditor = (): EditorView | null => current

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const getSnapshot = (): EditorView | null => current

export const useActiveRawEditor = (): EditorView | null =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
