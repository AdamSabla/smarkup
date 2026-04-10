import { create } from 'zustand'
// Type-only imports — erased at build time.
import type { FileEntry, Settings, Theme, UpdateStatus } from '../../../preload'

export type EditorMode = 'visual' | 'raw'

export type OpenFile = {
  /** Stable id — uses the absolute path */
  id: string
  /** Absolute path on disk */
  path: string
  /** Display name (basename) */
  name: string
  /** Markdown source — source of truth */
  content: string
  /** Content last loaded or saved to disk (to detect dirty state) */
  savedContent: string
}

export type SidebarSection = {
  /** Absolute folder path, or the sentinel `"drafts"` for the drafts section */
  id: string
  /** Display label */
  label: string
  /** Actual path on disk (null for a missing drafts folder) */
  path: string | null
  /** Direct .md children, sorted by mtime desc (most-recent first) */
  files: FileEntry[]
  /** Whether it's the user's drafts section */
  isDrafts: boolean
}

type WorkspaceState = {
  // --- Persistent settings (mirrored from disk) ---
  draftsFolder: string | null
  additionalFolders: string[]
  theme: Theme
  sidebarVisible: boolean
  editorMode: EditorMode

  // --- Volatile UI state ---
  sections: SidebarSection[]
  tabs: OpenFile[]
  activeTabId: string | null
  updateStatus: UpdateStatus
  settingsOpen: boolean

  // --- Actions ---
  hydrate: () => Promise<void>
  refreshAllSections: () => Promise<void>
  refreshSection: (sectionId: string) => Promise<void>

  setDraftsFolder: (path: string | null) => Promise<void>
  addFolder: (path: string) => Promise<void>
  removeFolder: (path: string) => Promise<void>

  openFile: (path: string) => Promise<void>
  createDraft: () => Promise<void>
  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
  updateActiveContent: (content: string) => void
  saveActive: () => Promise<void>

  toggleSidebar: () => Promise<void>
  setEditorMode: (mode: EditorMode) => Promise<void>
  setTheme: (theme: Theme) => Promise<void>
  openSettings: () => void
  closeSettings: () => void

  setUpdateStatus: (status: UpdateStatus) => void
  checkForUpdates: () => Promise<void>
}

const DRAFTS_ID = 'drafts'

const readMarkdownFiles = async (path: string): Promise<FileEntry[]> => {
  const entries = await window.api.readDirectory(path)
  return entries
    .filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.md'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

const buildDraftsSection = async (path: string | null): Promise<SidebarSection> => ({
  id: DRAFTS_ID,
  label: 'Drafts',
  path,
  files: path ? await readMarkdownFiles(path).catch(() => []) : [],
  isDrafts: true
})

const buildFolderSection = async (path: string): Promise<SidebarSection> => {
  const label = path.split('/').pop() || path
  return {
    id: path,
    label,
    path,
    files: await readMarkdownFiles(path).catch(() => []),
    isDrafts: false
  }
}

const persistSettings = (patch: Partial<Settings>): Promise<Settings> =>
  window.api.saveSettings(patch)

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  draftsFolder: null,
  additionalFolders: [],
  theme: 'system',
  sidebarVisible: true,
  editorMode: 'visual',

  sections: [],
  tabs: [],
  activeTabId: null,
  updateStatus: { kind: 'idle' },
  settingsOpen: false,

  hydrate: async () => {
    const settings = await window.api.loadSettings()
    set({
      draftsFolder: settings.draftsFolder,
      additionalFolders: settings.additionalFolders,
      theme: settings.theme,
      sidebarVisible: settings.sidebarVisible,
      editorMode: settings.editorMode
    })
    await get().refreshAllSections()
  },

  refreshAllSections: async () => {
    const { draftsFolder, additionalFolders } = get()
    const drafts = await buildDraftsSection(draftsFolder)
    const folders = await Promise.all(additionalFolders.map(buildFolderSection))
    set({ sections: [drafts, ...folders] })
  },

  refreshSection: async (sectionId) => {
    const section = get().sections.find((s) => s.id === sectionId)
    if (!section) return
    let rebuilt: SidebarSection
    if (section.isDrafts) {
      rebuilt = await buildDraftsSection(get().draftsFolder)
    } else if (section.path) {
      rebuilt = await buildFolderSection(section.path)
    } else {
      return
    }
    set((s) => ({
      sections: s.sections.map((sec) => (sec.id === sectionId ? rebuilt : sec))
    }))
  },

  setDraftsFolder: async (path) => {
    await persistSettings({ draftsFolder: path })
    set({ draftsFolder: path })
    await get().refreshSection(DRAFTS_ID)
  },

  addFolder: async (path) => {
    const current = get().additionalFolders
    if (current.includes(path)) return
    const next = [...current, path]
    await persistSettings({ additionalFolders: next })
    set({ additionalFolders: next })
    const section = await buildFolderSection(path)
    set((s) => ({ sections: [...s.sections, section] }))
  },

  removeFolder: async (path) => {
    const next = get().additionalFolders.filter((p) => p !== path)
    await persistSettings({ additionalFolders: next })
    set((s) => ({
      additionalFolders: next,
      sections: s.sections.filter((sec) => sec.id !== path)
    }))
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

  createDraft: async () => {
    const { draftsFolder, openSettings } = get()
    if (!draftsFolder) {
      openSettings()
      return
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const newPath = await window.api.createFile(draftsFolder, `untitled-${timestamp}.md`)
    await get().refreshSection(DRAFTS_ID)
    await get().openFile(newPath)
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

  reorderTabs: (fromIndex, toIndex) =>
    set((s) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= s.tabs.length ||
        toIndex >= s.tabs.length ||
        fromIndex === toIndex
      ) {
        return s
      }
      const next = [...s.tabs]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return { tabs: next }
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
    // Refresh the section that contains this file so MRU order updates
    const sections = get().sections
    const parent = sections.find((sec) => sec.files.some((f) => f.path === tab.path))
    if (parent) await get().refreshSection(parent.id)
  },

  toggleSidebar: async () => {
    const next = !get().sidebarVisible
    set({ sidebarVisible: next })
    await persistSettings({ sidebarVisible: next })
  },

  setEditorMode: async (mode) => {
    set({ editorMode: mode })
    await persistSettings({ editorMode: mode })
  },

  setTheme: async (theme) => {
    set({ theme })
    await persistSettings({ theme })
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  setUpdateStatus: (status) => set({ updateStatus: status }),

  checkForUpdates: async () => {
    const status = await window.api.checkForUpdates()
    set({ updateStatus: status })
  }
}))
