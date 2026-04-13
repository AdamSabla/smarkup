import { create } from 'zustand'
// Type-only imports — erased at build time.
import type { FileEntry, Settings, Theme, UpdateStatus, WatchPayload, WindowInit } from '../../../preload'

export type EditorMode = 'visual' | 'raw'

// --- Pane tree types for split-screen ---
export type LeafPane = { type: 'leaf'; id: string; tabId: string | null }
export type SplitPane = {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  children: [PaneNode, PaneNode]
  sizes: [number, number]
}
export type PaneNode = LeafPane | SplitPane

let paneIdCounter = 0
const nextPaneId = (): string => `pane-${++paneIdCounter}`

/** Find the leaf pane showing a given tabId */
const findLeafByTabId = (node: PaneNode, tabId: string): LeafPane | null => {
  if (node.type === 'leaf') return node.tabId === tabId ? node : null
  return findLeafByTabId(node.children[0], tabId) ?? findLeafByTabId(node.children[1], tabId)
}

/** Find a node by its id */
const findNodeById = (node: PaneNode, id: string): PaneNode | null => {
  if (node.id === id) return node
  if (node.type === 'leaf') return null
  return findNodeById(node.children[0], id) ?? findNodeById(node.children[1], id)
}

/** Collect all leaf pane ids in order */
const collectLeafIds = (node: PaneNode): string[] => {
  if (node.type === 'leaf') return [node.id]
  return [...collectLeafIds(node.children[0]), ...collectLeafIds(node.children[1])]
}

/** Replace a node in the tree by id, returning a new tree */
const replaceNode = (root: PaneNode, targetId: string, replacement: PaneNode): PaneNode => {
  if (root.id === targetId) return replacement
  if (root.type === 'leaf') return root
  return {
    ...root,
    children: [
      replaceNode(root.children[0], targetId, replacement),
      replaceNode(root.children[1], targetId, replacement)
    ] as [PaneNode, PaneNode]
  }
}

/** Find the parent split of a node by id */
const findParent = (root: PaneNode, targetId: string): SplitPane | null => {
  if (root.type === 'leaf') return null
  if (root.children[0].id === targetId || root.children[1].id === targetId) return root
  return findParent(root.children[0], targetId) ?? findParent(root.children[1], targetId)
}

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

export type FolderNode = {
  name: string
  path: string
  files: FileEntry[]
  subfolders: FolderNode[]
}

export type SidebarSection = {
  /** Absolute folder path, or the sentinel `"drafts"` for the drafts section */
  id: string
  /** Display label */
  label: string
  /** Actual path on disk (null for a missing drafts folder) */
  path: string | null
  /** Direct .md children at the section root, sorted by mtime desc */
  files: FileEntry[]
  /** Nested subfolders (each with their own files and subfolders) */
  subfolders: FolderNode[]
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
  recentFiles: string[]
  autoSave: boolean
  autoSaveDelayMs: number
  showWordCount: boolean

  // --- Volatile UI state ---
  sections: SidebarSection[]
  tabs: OpenFile[]
  activeTabId: string | null
  paneRoot: PaneNode
  activePaneId: string
  updateStatus: UpdateStatus
  settingsOpen: boolean
  /** ⌘P file fuzzy finder */
  quickOpenOpen: boolean
  /** ⌘K command palette */
  commandPaletteOpen: boolean
  /** Tab id currently being renamed inline (⌘R) */
  renamingTabId: string | null
  /** Remembered scroll-top per tab id (volatile, not persisted to disk) */
  scrollPositions: Record<string, number>
  hydrated: boolean

  // --- Actions ---
  hydrate: () => Promise<void>
  refreshAllSections: () => Promise<void>
  refreshSection: (sectionId: string) => Promise<void>
  handleWatchEvent: (payload: WatchPayload) => Promise<void>

  setDraftsFolder: (path: string | null) => Promise<void>
  addFolder: (path: string) => Promise<void>
  removeFolder: (path: string) => Promise<void>

  createSubfolder: (parentPath: string) => Promise<string>
  renameFolder: (oldPath: string, newName: string) => Promise<string>

  openFile: (path: string) => Promise<void>
  createDraft: () => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  moveFile: (path: string, destDir: string) => Promise<void>

  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  closeAllTabs: () => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
  updateActiveContent: (content: string) => void
  saveActive: () => Promise<void>

  // --- Pane actions ---
  splitPane: (paneId: string, direction: 'horizontal' | 'vertical', tabId: string | null) => void
  closePane: (paneId: string) => void
  setActivePane: (paneId: string) => void
  setPaneTab: (paneId: string, tabId: string) => void
  resizePanes: (splitId: string, sizes: [number, number]) => void
  updateTabContent: (tabId: string, content: string) => void

  toggleSidebar: () => Promise<void>
  setEditorMode: (mode: EditorMode) => Promise<void>
  setTheme: (theme: Theme) => Promise<void>
  setAutoSave: (enabled: boolean) => Promise<void>
  setShowWordCount: (enabled: boolean) => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  openQuickOpen: () => void
  closeQuickOpen: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  saveScrollPosition: (tabId: string, scrollTop: number) => void
  startRenamingTab: () => void
  cancelRenamingTab: () => void

  setUpdateStatus: (status: UpdateStatus) => void
  checkForUpdates: () => Promise<void>
}

const MAX_RECENT_FILES = 20

const DRAFTS_ID = 'drafts'

const readFolderTree = async (dirPath: string): Promise<FolderNode> => {
  const entries = await window.api.readDirectory(dirPath)
  const files = entries
    .filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.md'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const dirs = entries.filter((e) => e.isDirectory).sort((a, b) => a.name.localeCompare(b.name))
  const allSubs = await Promise.all(
    dirs.map((d) =>
      readFolderTree(d.path).catch(() => ({
        name: d.name,
        path: d.path,
        files: [] as FileEntry[],
        subfolders: [] as FolderNode[]
      }))
    )
  )
  return {
    name: dirPath.split('/').pop() || dirPath,
    path: dirPath,
    files,
    subfolders: allSubs
  }
}

const buildDraftsSection = async (path: string | null): Promise<SidebarSection> => {
  if (!path)
    return { id: DRAFTS_ID, label: 'Drafts', path, files: [], subfolders: [], isDrafts: true }
  const tree = await readFolderTree(path).catch(() => ({
    name: 'Drafts',
    path,
    files: [] as FileEntry[],
    subfolders: [] as FolderNode[]
  }))
  return {
    id: DRAFTS_ID,
    label: 'Drafts',
    path,
    files: tree.files,
    subfolders: tree.subfolders,
    isDrafts: true
  }
}

const buildFolderSection = async (path: string): Promise<SidebarSection> => {
  const label = path.split('/').pop() || path
  const tree = await readFolderTree(path).catch(() => ({
    name: label,
    path,
    files: [] as FileEntry[],
    subfolders: [] as FolderNode[]
  }))
  return { id: path, label, path, files: tree.files, subfolders: tree.subfolders, isDrafts: false }
}

const sectionContainsFile = (section: SidebarSection, filePath: string): boolean => {
  const searchNode = (node: FolderNode): boolean =>
    node.files.some((f) => f.path === filePath) || node.subfolders.some(searchNode)
  return section.files.some((f) => f.path === filePath) || section.subfolders.some(searchNode)
}

const persistSettings = (patch: Partial<Settings>): Promise<Settings> =>
  window.api.saveSettings(patch)

const collectWatchedFolders = (
  draftsFolder: string | null,
  additionalFolders: string[]
): string[] => {
  const set = new Set<string>()
  if (draftsFolder) set.add(draftsFolder)
  for (const f of additionalFolders) set.add(f)
  return Array.from(set)
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  draftsFolder: null,
  additionalFolders: [],
  theme: 'system',
  sidebarVisible: true,
  editorMode: 'visual',
  recentFiles: [],
  autoSave: false,
  autoSaveDelayMs: 1500,
  showWordCount: false,

  sections: [],
  tabs: [],
  activeTabId: null,
  paneRoot: { type: 'leaf', id: 'root', tabId: null },
  activePaneId: 'root',
  updateStatus: { kind: 'idle' },
  settingsOpen: false,
  quickOpenOpen: false,
  commandPaletteOpen: false,
  renamingTabId: null,
  scrollPositions: {},
  hydrated: false,

  hydrate: async () => {
    const settings = await window.api.loadSettings()
    set({
      draftsFolder: settings.draftsFolder,
      additionalFolders: settings.additionalFolders,
      theme: settings.theme,
      sidebarVisible: settings.sidebarVisible,
      editorMode: settings.editorMode,
      recentFiles: settings.recentFiles ?? [],
      autoSave: settings.autoSave ?? false,
      autoSaveDelayMs: settings.autoSaveDelayMs ?? 1500,
      showWordCount: settings.showWordCount ?? false
    })
    await get().refreshAllSections()

    // Check if this is a new window with init data from the main process
    const windowId = window.api.getWindowId()
    const windowInit: WindowInit | null =
      windowId !== 'default' ? await window.api.getWindowInit(windowId) : null

    const restoredTabs: OpenFile[] = []

    if (windowInit?.tabs && windowInit.tabs.length > 0) {
      // New window with transferred tabs — use init data directly
      for (const t of windowInit.tabs) {
        const name = await window.api.basename(t.path)
        restoredTabs.push({
          id: t.path,
          path: t.path,
          name,
          content: t.content,
          savedContent: t.savedContent
        })
      }
    } else {
      // Default window — restore open tabs from settings
      for (const path of settings.openTabs) {
        try {
          const content = await window.api.readFile(path)
          const name = await window.api.basename(path)
          restoredTabs.push({ id: path, path, name, content, savedContent: content })
        } catch {
          // File is gone — silently skip
        }
      }
    }

    const activeTabPath = windowInit?.activeTabPath ?? settings.activeTabPath
    const activeTabId =
      activeTabPath && restoredTabs.some((t) => t.id === activeTabPath)
        ? activeTabPath
        : (restoredTabs[restoredTabs.length - 1]?.id ?? null)
    set({
      tabs: restoredTabs,
      activeTabId,
      paneRoot: { type: 'leaf', id: 'root', tabId: activeTabId },
      activePaneId: 'root',
      hydrated: true
    })

    // Start file watchers
    const { draftsFolder, additionalFolders } = get()
    await window.api.syncWatchedFolders(collectWatchedFolders(draftsFolder, additionalFolders))
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

  handleWatchEvent: async (payload) => {
    const { sections, tabs, activeTabId } = get()
    const parent =
      sections.find((sec) => sec.path === payload.folder) ??
      sections.find((sec) => sec.isDrafts && sec.path === payload.folder)
    if (parent) {
      await get().refreshSection(parent.id)
    }

    // If any unlinked file is currently open in a tab, close it silently
    for (const evt of payload.events) {
      if (evt.type === 'unlink') {
        const tab = tabs.find((t) => t.path === evt.path)
        if (tab) {
          set((s) => {
            const nextTabs = s.tabs.filter((t) => t.id !== tab.id)
            const nextActive = activeTabId === tab.id ? (nextTabs[0]?.id ?? null) : s.activeTabId
            return { tabs: nextTabs, activeTabId: nextActive }
          })
        }
      } else if (evt.type === 'change') {
        // External edit — reload the file's content if it's open and clean
        const tab = tabs.find((t) => t.path === evt.path)
        if (tab && tab.content === tab.savedContent) {
          try {
            const content = await window.api.readFile(evt.path)
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.id === tab.id ? { ...t, content, savedContent: content } : t
              )
            }))
          } catch {
            // ignore
          }
        }
      }
    }
  },

  setDraftsFolder: async (path) => {
    await persistSettings({ draftsFolder: path })
    set({ draftsFolder: path })
    await get().refreshSection(DRAFTS_ID)
    const { additionalFolders } = get()
    await window.api.syncWatchedFolders(collectWatchedFolders(path, additionalFolders))
  },

  addFolder: async (path) => {
    const current = get().additionalFolders
    if (current.includes(path)) return
    const next = [...current, path]
    await persistSettings({ additionalFolders: next })
    set({ additionalFolders: next })
    const section = await buildFolderSection(path)
    set((s) => ({ sections: [...s.sections, section] }))
    const { draftsFolder } = get()
    await window.api.syncWatchedFolders(collectWatchedFolders(draftsFolder, next))
  },

  removeFolder: async (path) => {
    const next = get().additionalFolders.filter((p) => p !== path)
    await persistSettings({ additionalFolders: next })
    set((s) => ({
      additionalFolders: next,
      sections: s.sections.filter((sec) => sec.id !== path)
    }))
    const { draftsFolder } = get()
    await window.api.syncWatchedFolders(collectWatchedFolders(draftsFolder, next))
  },

  createSubfolder: async (parentPath) => {
    const newPath = await window.api.createDirectory(parentPath, 'untitled')
    const section = get().sections.find(
      (s) => s.path && (parentPath === s.path || parentPath.startsWith(s.path + '/'))
    )
    if (section) await get().refreshSection(section.id)
    return newPath
  },

  renameFolder: async (oldPath, newName) => {
    const newPath = await window.api.rename(oldPath, newName)
    await get().refreshAllSections()
    return newPath
  },

  openFile: async (path) => {
    // Track recent file regardless of whether it's already open
    const prevRecent = get().recentFiles
    const nextRecent = [path, ...prevRecent.filter((p) => p !== path)].slice(0, MAX_RECENT_FILES)
    if (nextRecent[0] !== prevRecent[0] || nextRecent.length !== prevRecent.length) {
      set({ recentFiles: nextRecent })
      void persistSettings({ recentFiles: nextRecent })
    }

    const existing = get().tabs.find((t) => t.path === path)
    if (existing) {
      get().setActiveTab(existing.id)
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
    const { paneRoot, activePaneId } = get()
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      paneRoot: replaceNode(paneRoot, activePaneId, { type: 'leaf', id: activePaneId, tabId: tab.id })
    }))
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

  renameFile: async (oldPath, newName) => {
    const safeName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = await window.api.rename(oldPath, safeName)
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === oldPath ? { ...t, id: newPath, path: newPath, name: safeName } : t
      ),
      activeTabId: s.activeTabId === oldPath ? newPath : s.activeTabId,
      renamingTabId: s.renamingTabId === oldPath ? null : s.renamingTabId
    }))
    await get().refreshAllSections()
  },

  deleteFile: async (path) => {
    await window.api.deletePath(path)
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path)
      if (idx === -1) return s
      const nextTabs = s.tabs.filter((t) => t.path !== path)
      const nextActive =
        s.activeTabId === path
          ? (nextTabs[Math.min(idx, nextTabs.length - 1)]?.id ?? null)
          : s.activeTabId
      return { tabs: nextTabs, activeTabId: nextActive }
    })
    await get().refreshAllSections()
  },

  moveFile: async (path, destDir) => {
    const newPath = await window.api.move(path, destDir)
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.path === path
          ? { ...t, id: newPath, path: newPath, name: newPath.split('/').pop() ?? t.name }
          : t
      ),
      activeTabId: s.activeTabId === path ? newPath : s.activeTabId
    }))
    await get().refreshAllSections()
  },

  setActiveTab: (id) => {
    const { paneRoot, activePaneId } = get()
    // If a pane already shows this tab, focus that pane
    const existingLeaf = findLeafByTabId(paneRoot, id)
    if (existingLeaf) {
      set({ activeTabId: id, activePaneId: existingLeaf.id })
    } else {
      // Update the active pane to show this tab
      set({
        activeTabId: id,
        paneRoot: replaceNode(paneRoot, activePaneId, {
          type: 'leaf',
          id: activePaneId,
          tabId: id
        })
      })
    }
  },

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
      // Update any pane showing this tab to show null (or the next active)
      const updatePaneTree = (node: PaneNode): PaneNode => {
        if (node.type === 'leaf') {
          if (node.tabId === id) {
            return { ...node, tabId: node.id === s.activePaneId ? nextActive : null }
          }
          return node
        }
        return {
          ...node,
          children: [updatePaneTree(node.children[0]), updatePaneTree(node.children[1])] as [PaneNode, PaneNode]
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...restScroll } = s.scrollPositions
      return { tabs: nextTabs, activeTabId: nextActive, paneRoot: updatePaneTree(s.paneRoot), scrollPositions: restScroll }
    }),

  closeOtherTabs: (id) =>
    set((s) => {
      const keep = s.tabs.find((t) => t.id === id)
      if (!keep) return s
      const keptScroll = s.scrollPositions[id]
      return {
        tabs: [keep],
        activeTabId: keep.id,
        scrollPositions: keptScroll !== undefined ? { [id]: keptScroll } : {}
      }
    }),

  closeAllTabs: () => set({ tabs: [], activeTabId: null, scrollPositions: {} }),

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
    const sections = get().sections
    const parent = sections.find((sec) => sectionContainsFile(sec, tab.path))
    if (parent) await get().refreshSection(parent.id)
  },

  // --- Pane actions ---

  splitPane: (paneId, direction, tabId) => {
    const { paneRoot } = get()
    const target = findNodeById(paneRoot, paneId)
    if (!target || target.type !== 'leaf') return
    const newLeafId = nextPaneId()
    const replacement: SplitPane = {
      type: 'split',
      id: nextPaneId(),
      direction,
      children: [
        { ...target },
        { type: 'leaf', id: newLeafId, tabId }
      ],
      sizes: [50, 50]
    }
    set({
      paneRoot: replaceNode(paneRoot, paneId, replacement),
      activePaneId: newLeafId,
      activeTabId: tabId ?? get().activeTabId
    })
  },

  closePane: (paneId) => {
    const { paneRoot } = get()
    // If it's the root leaf, don't close — just clear it
    if (paneRoot.type === 'leaf') {
      set({ paneRoot: { ...paneRoot, tabId: null }, activeTabId: null })
      return
    }
    const parent = findParent(paneRoot, paneId)
    if (!parent) return
    // The sibling replaces the parent
    const sibling = parent.children[0].id === paneId ? parent.children[1] : parent.children[0]
    const newRoot = replaceNode(paneRoot, parent.id, sibling)
    // Focus the first leaf of the sibling
    const leaves = collectLeafIds(sibling)
    const newActivePaneId = leaves[0] ?? 'root'
    const newActiveLeaf = findNodeById(newRoot, newActivePaneId)
    const newActiveTabId = newActiveLeaf?.type === 'leaf' ? newActiveLeaf.tabId : get().activeTabId
    set({
      paneRoot: newRoot,
      activePaneId: newActivePaneId,
      activeTabId: newActiveTabId ?? get().activeTabId
    })
  },

  setActivePane: (paneId) => {
    const { paneRoot } = get()
    const node = findNodeById(paneRoot, paneId)
    if (!node || node.type !== 'leaf') return
    set({ activePaneId: paneId, activeTabId: node.tabId ?? get().activeTabId })
  },

  setPaneTab: (paneId, tabId) => {
    const { paneRoot } = get()
    set({
      paneRoot: replaceNode(paneRoot, paneId, { type: 'leaf', id: paneId, tabId }),
      activePaneId: paneId,
      activeTabId: tabId
    })
  },

  resizePanes: (splitId, sizes) => {
    const { paneRoot } = get()
    const node = findNodeById(paneRoot, splitId)
    if (!node || node.type !== 'split') return
    set({ paneRoot: replaceNode(paneRoot, splitId, { ...node, sizes }) })
  },

  updateTabContent: (tabId, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, content } : t))
    })),

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

  setAutoSave: async (enabled) => {
    set({ autoSave: enabled })
    await persistSettings({ autoSave: enabled })
  },

  setShowWordCount: async (enabled) => {
    set({ showWordCount: enabled })
    await persistSettings({ showWordCount: enabled })
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openQuickOpen: () => set({ quickOpenOpen: true }),
  closeQuickOpen: () => set({ quickOpenOpen: false }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  saveScrollPosition: (tabId, scrollTop) =>
    set((s) => ({
      scrollPositions: { ...s.scrollPositions, [tabId]: scrollTop }
    })),
  startRenamingTab: () => {
    const { activeTabId } = get()
    if (activeTabId) set({ renamingTabId: activeTabId })
  },
  cancelRenamingTab: () => set({ renamingTabId: null }),

  setUpdateStatus: (status) => set({ updateStatus: status }),

  checkForUpdates: async () => {
    const status = await window.api.checkForUpdates()
    set({ updateStatus: status })
  }
}))
