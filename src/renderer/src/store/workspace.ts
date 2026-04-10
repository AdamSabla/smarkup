import { create } from 'zustand'
import type { FileEntry } from '../../../preload'

export type EditorMode = 'visual' | 'raw'

export type OpenFile = {
  /** Stable id — uses the absolute path */
  id: string
  /** Absolute path on disk */
  path: string
  /** Display name */
  name: string
  /** Markdown source — the source of truth */
  content: string
  /** Content last loaded or saved to disk (to detect dirty state) */
  savedContent: string
}

type WorkspaceState = {
  rootPath: string | null
  entries: FileEntry[]
  tabs: OpenFile[]
  activeTabId: string | null
  editorMode: EditorMode
  sidebarVisible: boolean

  setRoot: (path: string) => Promise<void>
  refreshRoot: () => Promise<void>
  openFile: (path: string) => Promise<void>
  createFileInRoot: () => Promise<void>
  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  updateActiveContent: (content: string) => void
  saveActive: () => Promise<void>
  toggleSidebar: () => void
  setEditorMode: (mode: EditorMode) => void
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  rootPath: null,
  entries: [],
  tabs: [],
  activeTabId: null,
  editorMode: 'visual',
  sidebarVisible: true,

  setRoot: async (path) => {
    const entries = await window.api.readDirectory(path)
    set({ rootPath: path, entries })
  },

  refreshRoot: async () => {
    const { rootPath } = get()
    if (!rootPath) return
    const entries = await window.api.readDirectory(rootPath)
    set({ entries })
  },

  openFile: async (path) => {
    const existing = get().tabs.find((t) => t.path === path)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const content = await window.api.readFile(path)
    const name = await window.api.basename(path)
    const tab: OpenFile = {
      id: path,
      path,
      name,
      content,
      savedContent: content
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  createFileInRoot: async () => {
    const { rootPath, refreshRoot, openFile } = get()
    if (!rootPath) return
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const newPath = await window.api.createFile(rootPath, `untitled-${timestamp}.md`)
    await refreshRoot()
    await openFile(newPath)
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id)
      if (idx === -1) return s
      const nextTabs = s.tabs.filter((t) => t.id !== id)
      let nextActive = s.activeTabId
      if (s.activeTabId === id) {
        if (nextTabs.length === 0) {
          nextActive = null
        } else {
          const neighbor = nextTabs[Math.min(idx, nextTabs.length - 1)]
          nextActive = neighbor.id
        }
      }
      return { tabs: nextTabs, activeTabId: nextActive }
    }),

  updateActiveContent: (content) =>
    set((s) => {
      if (!s.activeTabId) return s
      return {
        tabs: s.tabs.map((t) => (t.id === s.activeTabId ? { ...t, content } : t))
      }
    }),

  saveActive: async () => {
    const { tabs, activeTabId } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    if (tab.content === tab.savedContent) return
    await window.api.writeFile(tab.path, tab.content)
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, savedContent: tab.content } : t))
    }))
  },

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

  setEditorMode: (mode) => set({ editorMode: mode })
}))
