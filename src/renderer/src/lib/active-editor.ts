import { useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/react'

/**
 * Module-level reference to the currently mounted Tiptap visual editor.
 *
 * The visual editor is a live, mutable instance that other parts of the app
 * (primarily the command palette) need access to for running commands like
 * "insert table". Putting the editor inside zustand would cause needless
 * re-renders on every transaction, so we use a small standalone store with
 * explicit subscribe semantics instead.
 */

let current: Editor | null = null
const listeners = new Set<() => void>()

const emit = (): void => {
  for (const l of listeners) l()
}

export const setActiveEditor = (editor: Editor | null): void => {
  if (current === editor) return
  current = editor
  emit()
}

export const getActiveEditor = (): Editor | null => current

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const getSnapshot = (): Editor | null => current

/**
 * Hook that returns the currently active visual editor (or null). Components
 * re-render whenever the active editor swaps out (e.g. tab switch, or the
 * user toggles visual/raw mode).
 */
export const useActiveEditor = (): Editor | null =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
