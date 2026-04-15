import { create } from 'zustand'
// Type-only imports — erased at build time.
import type {
  FileEntry,
  Settings,
  Theme,
  UpdateStatus,
  WatchPayload,
  WindowInit
} from '../../../preload'
import { deriveFilenameFromContent } from '@/lib/derive-filename'

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

/** Rewrite the state so every tab/pane/activeTab reference to `oldPath`
 *  (or any descendant path `oldPath + '/...'`) points at the new location.
 *  Used after a folder rename/move — the folder's subtree of files all get
 *  new absolute paths in one shot, and the tab ids must follow. */
const remapPathPrefix = (
  s: { tabs: OpenFile[]; activeTabId: string | null; paneRoot: PaneNode },
  oldPath: string,
  newPath: string
): { tabs: OpenFile[]; activeTabId: string | null; paneRoot: PaneNode } => {
  if (oldPath === newPath) return s
  const prefix = oldPath + '/'
  const map = (p: string): string =>
    p === oldPath ? newPath : p.startsWith(prefix) ? newPath + p.slice(oldPath.length) : p
  let paneRoot = s.paneRoot
  const tabs = s.tabs.map((t) => {
    const mapped = map(t.path)
    if (mapped === t.path) return t
    paneRoot = remapPaneTabId(paneRoot, t.id, mapped)
    return { ...t, id: mapped, path: mapped, name: mapped.split('/').pop() ?? t.name }
  })
  const activeTabId = s.activeTabId ? map(s.activeTabId) : s.activeTabId
  return { tabs, activeTabId, paneRoot }
}

/** Same prefix-rewrite logic as remapPathPrefix, but for the autoNamedPaths
 *  set. Used after a folder rename/move so files inside still get auto-named. */
const remapAutoNamedPaths = (paths: Set<string>, oldPath: string, newPath: string): Set<string> => {
  if (oldPath === newPath || paths.size === 0) return paths
  const prefix = oldPath + '/'
  let changed = false
  const next = new Set<string>()
  for (const p of paths) {
    if (p === oldPath) {
      next.add(newPath)
      changed = true
    } else if (p.startsWith(prefix)) {
      next.add(newPath + p.slice(oldPath.length))
      changed = true
    } else {
      next.add(p)
    }
  }
  return changed ? next : paths
}

/** Rewrite any leaf whose `tabId` matches `oldTabId` to reference `newTabId`.
 *  Used after rename/move, where the tab's id changes but the pane leaf
 *  still holds the stale id — without this, the pane points at a tab that
 *  no longer exists and the editor falls back to the empty state. */
const remapPaneTabId = (root: PaneNode, oldTabId: string, newTabId: string): PaneNode => {
  if (root.type === 'leaf') {
    return root.tabId === oldTabId ? { ...root, tabId: newTabId } : root
  }
  return {
    ...root,
    children: [
      remapPaneTabId(root.children[0], oldTabId, newTabId),
      remapPaneTabId(root.children[1], oldTabId, newTabId)
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

/** Destination option for moving a file between folders. */
export type MoveTarget = {
  path: string
  label: string
}

/**
 * A close action that's waiting on the user to resolve unsaved changes.
 * When non-null, the UnsavedChangesDialog is shown.
 */
export type PendingClose =
  | { kind: 'tab'; tabId: string }
  | { kind: 'others'; keepTabId: string }
  | { kind: 'all' }
  | { kind: 'window' }

export type UnsavedChoice = 'save' | 'discard' | 'cancel'

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
  rawHeadingSizes: boolean
  rawWordWrap: boolean

  // --- Volatile UI state ---
  sections: SidebarSection[]
  /** Pre-computed destination folders for the "Move file" command (cached). */
  moveTargets: MoveTarget[]
  /** True while moveTargets are being rebuilt in the background. */
  moveTargetsLoading: boolean
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
  /** Keyboard shortcuts modal */
  shortcutsOpen: boolean
  /** Tab id currently being renamed inline (⌘R) */
  renamingTabId: string | null
  /** Remembered scroll anchor per tab id (volatile, not persisted to disk).
   *  number = absolute scrollTop px (visual editor),
   *  object = line + px offset within that line (raw/CodeMirror editor). */
  scrollPositions: Record<string, number | { line: number; offsetPx: number }>
  /** Remembered cursor/selection per tab id (volatile, not persisted to disk) */
  cursorPositions: Record<string, { anchor: number; head: number }>
  /** Paths that are collapsed in the sidebar tree (volatile, survives sidebar toggle) */
  sidebarCollapsedPaths: Set<string>
  /**
   * Files (by absolute path) whose name is still being auto-derived from
   * their first non-empty line. Removed once the user explicitly renames.
   * Persisted to settings so the auto-naming survives across sessions.
   */
  autoNamedPaths: Set<string>
  /**
   * Paths currently mid-rename by us. Used to suppress watcher self-echo
   * (the unlink/add events fired by the renames we just initiated).
   * Volatile — never persisted.
   */
  autoRenameInFlight: Set<string>
  /** A close action waiting on the user to resolve unsaved changes. */
  pendingClose: PendingClose | null
  hydrated: boolean

  // --- Actions ---
  hydrate: () => Promise<void>
  refreshAllSections: () => Promise<void>
  refreshSection: (sectionId: string) => Promise<void>
  /** Rebuild the cached move-file destination list from disk. */
  refreshMoveTargets: () => Promise<void>
  handleWatchEvent: (payload: WatchPayload) => Promise<void>

  setDraftsFolder: (path: string | null) => Promise<void>
  addFolder: (path: string) => Promise<void>
  removeFolder: (path: string) => Promise<void>

  createSubfolder: (parentPath: string) => Promise<string>
  renameFolder: (oldPath: string, newName: string) => Promise<string>

  openFile: (path: string) => Promise<void>
  createDraft: () => Promise<void>
  /**
   * If the active tab is in `autoNamedPaths`, derive a new filename from
   * its content's first non-empty line and rename the file on disk.
   * No-op if the derived name matches the current name, would collide
   * with another file, or the tab no longer qualifies. Called by the
   * `useAutoFilename` hook on debounced content change.
   */
  autoRenameActiveTab: () => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  moveFile: (path: string, destDir: string) => Promise<void>
  moveFolder: (path: string, destDir: string) => Promise<void>

  setActiveTab: (id: string) => void
  closeTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  closeAllTabs: () => void
  /** Close a tab, prompting to save if dirty and autosave is off. */
  requestCloseTab: (id: string) => void
  /** Close all tabs except the given one, prompting about any dirty ones. */
  requestCloseOtherTabs: (keepId: string) => void
  /** Close all tabs, prompting about any dirty ones. */
  requestCloseAllTabs: () => void
  /** The window has been asked to close; prompt about any dirty tabs. */
  requestCloseWindow: () => void
  /** Resolve the currently pending close with the user's choice. */
  resolvePendingClose: (choice: UnsavedChoice) => Promise<void>
  reorderTabs: (fromIndex: number, toIndex: number) => void
  updateActiveContent: (content: string) => void
  saveActive: () => Promise<void>
  /** Save a specific tab by id (writes to disk and clears its dirty state). */
  saveTab: (tabId: string) => Promise<void>

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
  setRawHeadingSizes: (enabled: boolean) => Promise<void>
  setRawWordWrap: (enabled: boolean) => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  openQuickOpen: () => void
  closeQuickOpen: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  openShortcuts: () => void
  closeShortcuts: () => void
  saveScrollPosition: (tabId: string, value: number | { line: number; offsetPx: number }) => void
  saveCursorPosition: (tabId: string, anchor: number, head: number) => void
  startRenamingTab: () => void
  cancelRenamingTab: () => void
  toggleSidebarCollapsedPath: (path: string) => void
  expandSidebarPaths: (...paths: string[]) => void
  collapseSidebarPath: (path: string) => void

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
  rawHeadingSizes: false,
  rawWordWrap: true,

  sections: [],
  moveTargets: [],
  moveTargetsLoading: false,
  tabs: [],
  activeTabId: null,
  paneRoot: { type: 'leaf', id: 'root', tabId: null },
  activePaneId: 'root',
  updateStatus: { kind: 'idle' },
  settingsOpen: false,
  quickOpenOpen: false,
  commandPaletteOpen: false,
  shortcutsOpen: false,
  renamingTabId: null,
  scrollPositions: {},
  cursorPositions: {},
  sidebarCollapsedPaths: new Set<string>(),
  autoNamedPaths: new Set<string>(),
  autoRenameInFlight: new Set<string>(),
  pendingClose: null,
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
      showWordCount: settings.showWordCount ?? false,
      rawHeadingSizes: settings.rawHeadingSizes ?? false,
      rawWordWrap: settings.rawWordWrap ?? true,
      autoNamedPaths: new Set(settings.autoNamedPaths ?? [])
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

    // Pre-compute the move-file destination list so the command palette
    // has it ready the first time the user opens "Move file…".
    void get().refreshMoveTargets()
  },

  refreshAllSections: async () => {
    const { draftsFolder, additionalFolders } = get()
    const drafts = await buildDraftsSection(draftsFolder)
    const folders = await Promise.all(additionalFolders.map(buildFolderSection))
    set({ sections: [drafts, ...folders] })
  },

  refreshMoveTargets: async () => {
    set({ moveTargetsLoading: true })
    const { draftsFolder, additionalFolders } = get()
    const roots: string[] = []
    if (draftsFolder) roots.push(draftsFolder)
    for (const f of additionalFolders) roots.push(f)

    const allPaths = new Set<string>(roots)
    await Promise.all(
      roots.map(async (root) => {
        try {
          const subs = await window.api.listFoldersRecursive(root)
          subs.forEach((s) => allPaths.add(s))
        } catch {
          // unreachable root — ignore
        }
      })
    )
    const targets: MoveTarget[] = Array.from(allPaths)
      .sort()
      .map((p) => {
        const matchingRoot = roots.find((r) => p === r || p.startsWith(r + '/'))
        const rootLabel = matchingRoot ? matchingRoot.split('/').pop() || matchingRoot : ''
        const rest = matchingRoot && p !== matchingRoot ? p.slice(matchingRoot.length + 1) : ''
        const label = rest ? `${rootLabel}/${rest}` : rootLabel
        return { path: p, label }
      })
    set({ moveTargets: targets, moveTargetsLoading: false })
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
    const { sections, tabs, activeTabId, autoRenameInFlight } = get()
    const parent =
      sections.find((sec) => sec.path === payload.folder) ??
      sections.find((sec) => sec.isDrafts && sec.path === payload.folder)
    if (parent) {
      await get().refreshSection(parent.id)
    }

    // If any unlinked file is currently open in a tab, close it silently
    for (const evt of payload.events) {
      // Suppress events for paths we're currently renaming ourselves —
      // otherwise the unlink half of our own rename would close the tab.
      if (autoRenameInFlight.has(evt.path)) continue
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
    void get().refreshMoveTargets()
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
    void get().refreshMoveTargets()
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
    void get().refreshMoveTargets()
  },

  createSubfolder: async (parentPath) => {
    const newPath = await window.api.createDirectory(parentPath, 'untitled')
    const section = get().sections.find(
      (s) => s.path && (parentPath === s.path || parentPath.startsWith(s.path + '/'))
    )
    if (section) await get().refreshSection(section.id)
    void get().refreshMoveTargets()
    return newPath
  },

  renameFolder: async (oldPath, newName) => {
    const newPath = await window.api.rename(oldPath, newName)
    // Any open tabs for files inside the renamed folder now point at stale
    // paths — rewrite them so they keep working.
    set((s) => {
      const remapped = remapPathPrefix(s, oldPath, newPath)
      const nextAutoNamed = remapAutoNamedPaths(s.autoNamedPaths, oldPath, newPath)
      return { ...remapped, autoNamedPaths: nextAutoNamed }
    })
    void persistSettings({ autoNamedPaths: Array.from(get().autoNamedPaths) })
    await get().refreshAllSections()
    void get().refreshMoveTargets()
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
      paneRoot: replaceNode(paneRoot, activePaneId, {
        type: 'leaf',
        id: activePaneId,
        tabId: tab.id
      })
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
    // Mark as auto-named so the next non-empty line typed becomes the filename.
    const nextAutoNamed = new Set(get().autoNamedPaths)
    nextAutoNamed.add(newPath)
    set({ autoNamedPaths: nextAutoNamed })
    void persistSettings({ autoNamedPaths: Array.from(nextAutoNamed) })
    await get().refreshSection(DRAFTS_ID)
    await get().openFile(newPath)
  },

  autoRenameActiveTab: async () => {
    const state = get()
    const { activeTabId, tabs, autoNamedPaths, autoRenameInFlight } = state
    if (!activeTabId) return
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    if (!autoNamedPaths.has(tab.path)) return
    if (autoRenameInFlight.has(tab.path)) return

    const derived = deriveFilenameFromContent(tab.content)
    if (!derived) return
    const nextName = `${derived}.md`
    if (nextName === tab.name) return

    // Same parent dir; rename only changes the basename.
    const parent = tab.path.slice(0, tab.path.lastIndexOf('/'))
    const nextPath = `${parent}/${nextName}`
    if (nextPath === tab.path) return

    // Skip silently if a file with the derived name already exists — we
    // don't want to clobber the user's data and we don't want to surface
    // an error for what's a best-effort convenience.
    try {
      const exists = await window.api.pathExists(nextPath)
      if (exists) return
    } catch {
      return
    }

    // Mark in-flight so the watcher self-echo doesn't close the tab.
    const inFlight = new Set(get().autoRenameInFlight)
    inFlight.add(tab.path)
    inFlight.add(nextPath)
    set({ autoRenameInFlight: inFlight })

    let renamedPath: string
    try {
      renamedPath = await window.api.rename(tab.path, nextName)
    } catch {
      // Rename can fail (path went away, permissions, etc.) — drop the
      // in-flight marker and bail. The user can keep typing; we'll try
      // again on the next debounce tick.
      const cleanup = new Set(get().autoRenameInFlight)
      cleanup.delete(tab.path)
      cleanup.delete(nextPath)
      set({ autoRenameInFlight: cleanup })
      return
    }

    const oldPath = tab.path
    set((s) => {
      // Atomically rewrite every path-keyed slot. Anything missed here
      // would either point at a stale tab id (pane goes blank) or hold
      // stale UI state (scroll/cursor/recent files).
      const nextTabs = s.tabs.map((t) =>
        t.path === oldPath ? { ...t, id: renamedPath, path: renamedPath, name: nextName } : t
      )
      const nextActive = s.activeTabId === oldPath ? renamedPath : s.activeTabId
      const nextPane = remapPaneTabId(s.paneRoot, oldPath, renamedPath)

      const nextScroll = { ...s.scrollPositions }
      if (oldPath in nextScroll) {
        nextScroll[renamedPath] = nextScroll[oldPath]
        delete nextScroll[oldPath]
      }
      const nextCursor = { ...s.cursorPositions }
      if (oldPath in nextCursor) {
        nextCursor[renamedPath] = nextCursor[oldPath]
        delete nextCursor[oldPath]
      }
      const nextRecent = s.recentFiles.map((p) => (p === oldPath ? renamedPath : p))

      const nextAutoNamed = new Set(s.autoNamedPaths)
      nextAutoNamed.delete(oldPath)
      nextAutoNamed.add(renamedPath)

      return {
        tabs: nextTabs,
        activeTabId: nextActive,
        paneRoot: nextPane,
        scrollPositions: nextScroll,
        cursorPositions: nextCursor,
        recentFiles: nextRecent,
        autoNamedPaths: nextAutoNamed
      }
    })

    void persistSettings({
      autoNamedPaths: Array.from(get().autoNamedPaths),
      recentFiles: get().recentFiles
    })

    // Refresh the parent section so the sidebar shows the new name.
    const sections = get().sections
    const parentSection =
      sections.find((sec) => sectionContainsFile(sec, oldPath)) ??
      sections.find((sec) => sectionContainsFile(sec, renamedPath))
    if (parentSection) await get().refreshSection(parentSection.id)

    // Drop the in-flight markers a tick after the watcher would have
    // delivered its events. 500ms is well past chokidar's debounce.
    setTimeout(() => {
      const cleanup = new Set(get().autoRenameInFlight)
      cleanup.delete(oldPath)
      cleanup.delete(renamedPath)
      set({ autoRenameInFlight: cleanup })
    }, 500)
  },

  renameFile: async (oldPath, newName) => {
    const safeName = newName.endsWith('.md') ? newName : `${newName}.md`
    const newPath = await window.api.rename(oldPath, safeName)
    set((s) => {
      // User-initiated rename "fixes" the name: drop the auto-named flag.
      const nextAutoNamed = new Set(s.autoNamedPaths)
      nextAutoNamed.delete(oldPath)
      nextAutoNamed.delete(newPath)
      return {
        tabs: s.tabs.map((t) =>
          t.path === oldPath ? { ...t, id: newPath, path: newPath, name: safeName } : t
        ),
        activeTabId: s.activeTabId === oldPath ? newPath : s.activeTabId,
        // Pane leaves reference tabs by id; the tab's id is the path, which
        // just changed — rewrite any matching leaf so the pane keeps showing
        // the file instead of falling back to the empty state.
        paneRoot: remapPaneTabId(s.paneRoot, oldPath, newPath),
        renamingTabId: s.renamingTabId === oldPath ? null : s.renamingTabId,
        autoNamedPaths: nextAutoNamed
      }
    })
    void persistSettings({ autoNamedPaths: Array.from(get().autoNamedPaths) })
    await get().refreshAllSections()
  },

  deleteFile: async (path) => {
    await window.api.deletePath(path)
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path)
      const nextAutoNamed = new Set(s.autoNamedPaths)
      nextAutoNamed.delete(path)
      if (idx === -1) return { autoNamedPaths: nextAutoNamed }
      const nextTabs = s.tabs.filter((t) => t.path !== path)
      const nextActive =
        s.activeTabId === path
          ? (nextTabs[Math.min(idx, nextTabs.length - 1)]?.id ?? null)
          : s.activeTabId
      return { tabs: nextTabs, activeTabId: nextActive, autoNamedPaths: nextAutoNamed }
    })
    void persistSettings({ autoNamedPaths: Array.from(get().autoNamedPaths) })
    await get().refreshAllSections()
  },

  moveFile: async (path, destDir) => {
    const newPath = await window.api.move(path, destDir)
    set((s) => {
      // Preserve the auto-named flag across the move — per the design,
      // auto-naming continues even after a draft leaves the drafts folder.
      const nextAutoNamed = new Set(s.autoNamedPaths)
      if (nextAutoNamed.has(path)) {
        nextAutoNamed.delete(path)
        nextAutoNamed.add(newPath)
      }
      return {
        tabs: s.tabs.map((t) =>
          t.path === path
            ? { ...t, id: newPath, path: newPath, name: newPath.split('/').pop() ?? t.name }
            : t
        ),
        activeTabId: s.activeTabId === path ? newPath : s.activeTabId,
        paneRoot: remapPaneTabId(s.paneRoot, path, newPath),
        autoNamedPaths: nextAutoNamed
      }
    })
    void persistSettings({ autoNamedPaths: Array.from(get().autoNamedPaths) })
    await get().refreshAllSections()
  },

  moveFolder: async (path, destDir) => {
    // Guard against dropping a folder into itself or one of its descendants —
    // the FS would happily create a loop and orphan the contents.
    if (destDir === path || destDir.startsWith(path + '/')) return
    // Same-parent drop is a no-op; avoid the round trip.
    const currentParent = path.slice(0, path.lastIndexOf('/'))
    if (currentParent === destDir) return
    const newPath = await window.api.move(path, destDir)
    set((s) => {
      const remapped = remapPathPrefix(s, path, newPath)
      const nextAutoNamed = remapAutoNamedPaths(s.autoNamedPaths, path, newPath)
      return { ...remapped, autoNamedPaths: nextAutoNamed }
    })
    void persistSettings({ autoNamedPaths: Array.from(get().autoNamedPaths) })
    await get().refreshAllSections()
    void get().refreshMoveTargets()
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
          children: [updatePaneTree(node.children[0]), updatePaneTree(node.children[1])] as [
            PaneNode,
            PaneNode
          ]
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...restScroll } = s.scrollPositions
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _c, ...restCursor } = s.cursorPositions
      return {
        tabs: nextTabs,
        activeTabId: nextActive,
        paneRoot: updatePaneTree(s.paneRoot),
        scrollPositions: restScroll,
        cursorPositions: restCursor
      }
    }),

  closeOtherTabs: (id) =>
    set((s) => {
      const keep = s.tabs.find((t) => t.id === id)
      if (!keep) return s
      const keptScroll = s.scrollPositions[id]
      const keptCursor = s.cursorPositions[id]
      return {
        tabs: [keep],
        activeTabId: keep.id,
        scrollPositions: keptScroll !== undefined ? { [id]: keptScroll } : {},
        cursorPositions: keptCursor !== undefined ? { [id]: keptCursor } : {}
      }
    }),

  closeAllTabs: () =>
    set({ tabs: [], activeTabId: null, scrollPositions: {}, cursorPositions: {} }),

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

  saveTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.content === tab.savedContent) return
    const pending = tab.content
    await window.api.writeFile(tab.path, pending)
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, savedContent: pending } : t))
    }))
  },

  // --- Close-with-unsaved-changes flow ---------------------------------
  //
  // With autosave OFF, we ask the user what to do (Save / Don't Save / Cancel)
  // via the UnsavedChangesDialog. With autosave ON, there can still be an
  // unflushed debounce window where the tab is dirty — in that case we flush
  // any dirty tabs to disk first and then close silently, since the user has
  // already opted into "save everything automatically".

  requestCloseTab: (id) => {
    const { tabs, autoSave } = get()
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    const dirty = tab.content !== tab.savedContent
    if (!dirty) {
      get().closeTab(id)
      return
    }
    if (autoSave) {
      void (async () => {
        await get().saveTab(id)
        get().closeTab(id)
      })()
      return
    }
    set({ pendingClose: { kind: 'tab', tabId: id } })
  },

  requestCloseOtherTabs: (keepId) => {
    const { tabs, autoSave } = get()
    const dirty = tabs.filter((t) => t.id !== keepId && t.content !== t.savedContent)
    if (dirty.length === 0) {
      get().closeOtherTabs(keepId)
      return
    }
    if (autoSave) {
      void (async () => {
        for (const t of dirty) await get().saveTab(t.id)
        get().closeOtherTabs(keepId)
      })()
      return
    }
    set({ pendingClose: { kind: 'others', keepTabId: keepId } })
  },

  requestCloseAllTabs: () => {
    const { tabs, autoSave } = get()
    const dirty = tabs.filter((t) => t.content !== t.savedContent)
    if (dirty.length === 0) {
      get().closeAllTabs()
      return
    }
    if (autoSave) {
      void (async () => {
        for (const t of dirty) await get().saveTab(t.id)
        get().closeAllTabs()
      })()
      return
    }
    set({ pendingClose: { kind: 'all' } })
  },

  requestCloseWindow: () => {
    const { tabs, autoSave } = get()
    const dirty = tabs.filter((t) => t.content !== t.savedContent)
    if (dirty.length === 0) {
      void window.api.confirmClose()
      return
    }
    if (autoSave) {
      void (async () => {
        for (const t of dirty) await get().saveTab(t.id)
        void window.api.confirmClose()
      })()
      return
    }
    set({ pendingClose: { kind: 'window' } })
  },

  resolvePendingClose: async (choice) => {
    const pc = get().pendingClose
    if (!pc) return

    // Close the dialog immediately so the user gets feedback.
    set({ pendingClose: null })

    if (choice === 'cancel') {
      // Nothing to do; if this was a window close, we simply leave it open.
      return
    }

    // Determine which tabs are in scope for this pending action.
    const { tabs } = get()
    const tabsInScope: OpenFile[] =
      pc.kind === 'tab'
        ? tabs.filter((t) => t.id === pc.tabId)
        : pc.kind === 'others'
          ? tabs.filter((t) => t.id !== pc.keepTabId)
          : tabs // 'all' and 'window' both cover every tab

    if (choice === 'save') {
      const dirty = tabsInScope.filter((t) => t.content !== t.savedContent)
      // Save sequentially to keep disk writes predictable and to surface
      // errors one at a time. If any save fails, abort the close so the
      // user doesn't lose data silently.
      for (const t of dirty) {
        try {
          await get().saveTab(t.id)
        } catch (err) {
          console.error('Failed to save tab before close:', t.path, err)
          // Re-show the dialog so the user can decide again.
          set({ pendingClose: pc })
          return
        }
      }
    }

    // Now perform the close action.
    switch (pc.kind) {
      case 'tab':
        get().closeTab(pc.tabId)
        break
      case 'others':
        get().closeOtherTabs(pc.keepTabId)
        break
      case 'all':
        get().closeAllTabs()
        break
      case 'window':
        void window.api.confirmClose()
        break
    }
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
      children: [{ ...target }, { type: 'leaf', id: newLeafId, tabId }],
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

  setRawHeadingSizes: async (enabled) => {
    set({ rawHeadingSizes: enabled })
    await persistSettings({ rawHeadingSizes: enabled })
  },

  setRawWordWrap: async (enabled) => {
    set({ rawWordWrap: enabled })
    await persistSettings({ rawWordWrap: enabled })
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openQuickOpen: () => set({ quickOpenOpen: true }),
  closeQuickOpen: () => set({ quickOpenOpen: false }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  openShortcuts: () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
  saveScrollPosition: (tabId, value) =>
    set((s) => ({
      scrollPositions: { ...s.scrollPositions, [tabId]: value }
    })),
  saveCursorPosition: (tabId, anchor, head) =>
    set((s) => ({
      cursorPositions: { ...s.cursorPositions, [tabId]: { anchor, head } }
    })),
  startRenamingTab: () => {
    const { activeTabId } = get()
    if (activeTabId) set({ renamingTabId: activeTabId })
  },
  cancelRenamingTab: () => set({ renamingTabId: null }),

  toggleSidebarCollapsedPath: (path) => {
    const current = get().sidebarCollapsedPaths
    const next = new Set(current)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    set({ sidebarCollapsedPaths: next })
  },

  expandSidebarPaths: (...paths) => {
    const current = get().sidebarCollapsedPaths
    const next = new Set(current)
    for (const p of paths) next.delete(p)
    set({ sidebarCollapsedPaths: next })
  },

  collapseSidebarPath: (path) => {
    const current = get().sidebarCollapsedPaths
    const next = new Set(current)
    next.add(path)
    set({ sidebarCollapsedPaths: next })
  },

  setUpdateStatus: (status) => set({ updateStatus: status }),

  checkForUpdates: async () => {
    const status = await window.api.checkForUpdates()
    set({ updateStatus: status })
  }
}))
