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
export type LeafPane = {
  type: 'leaf'
  id: string
  tabIds: string[]           // ordered tab references for this pane
  activeTabId: string | null // which tab is visible in this pane
}
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

/**
 * External-reload coordination state (module-level because it's purely
 * volatile — no component needs to render from it, and Zustand re-render
 * churn would be wasteful).
 *
 * - `lastTypedAt`: per-tab timestamp of the most recent *user* content edit.
 *   Used to defer reloading a file under a cursor mid-sentence when an
 *   external editor (or AI agent) writes while we're typing.
 * - `pendingReloads`: per-path debounced reload timers. Replaced on every
 *   new watcher event for the same path, and cancelled on save/close.
 *
 * See `doReload` / `scheduleReload` at the bottom of this file.
 */
const lastTypedAt = new Map<string, number>()
const pendingReloads = new Map<string, ReturnType<typeof setTimeout>>()
/** If the user typed within this window, defer the external reload until
 *  typing pauses. 1.5s is long enough to cover a sentence, short enough
 *  that an agent's writes still land quickly when the user pauses. */
const TYPING_DEFER_MS = 1500

/** Find the leaf pane whose active tab matches a given tabId */
const findLeafByTabId = (node: PaneNode, tabId: string): LeafPane | null => {
  if (node.type === 'leaf') return node.tabIds.includes(tabId) ? node : null
  return findLeafByTabId(node.children[0], tabId) ?? findLeafByTabId(node.children[1], tabId)
}

/** Find a leaf pane by its pane id */
const findLeafById = (node: PaneNode, paneId: string): LeafPane | null => {
  if (node.type === 'leaf') return node.id === paneId ? node : null
  if (node.type === 'split') {
    return findLeafById(node.children[0], paneId) ?? findLeafById(node.children[1], paneId)
  }
  return null
}

/** Collect all tab ids referenced by any leaf in the pane tree */
const collectAllPaneTabIds = (node: PaneNode): Set<string> => {
  if (node.type === 'leaf') return new Set(node.tabIds)
  const left = collectAllPaneTabIds(node.children[0])
  const right = collectAllPaneTabIds(node.children[1])
  for (const id of right) left.add(id)
  return left
}

/** Derive the global activeTabId from the active pane */
const deriveActiveTabId = (paneRoot: PaneNode, activePaneId: string): string | null => {
  const leaf = findLeafById(paneRoot, activePaneId)
  return leaf?.activeTabId ?? null
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

/**
 * Collapse empty leaf panes in splits. If a split has an empty leaf child,
 * replace the split with the non-empty sibling. Recurses so nested collapses
 * work. Returns the collapsed tree and the id of the leaf the activePaneId
 * should fall back to if the active pane was removed.
 */
const collapseEmptyPanes = (node: PaneNode): PaneNode => {
  if (node.type === 'leaf') return node
  const left = collapseEmptyPanes(node.children[0])
  const right = collapseEmptyPanes(node.children[1])
  // If either child is an empty leaf, collapse to the other child
  if (left.type === 'leaf' && left.tabIds.length === 0) return right
  if (right.type === 'leaf' && right.tabIds.length === 0) return left
  if (left === node.children[0] && right === node.children[1]) return node
  return { ...node, children: [left, right] as [PaneNode, PaneNode] }
}

/** Rewrite the state so every tab/pane/activeTab reference to `oldPath`
 *  (or any descendant path `oldPath + '/...'`) points at the new location.
 *  Used after a folder rename/move — the folder's subtree of files all get
 *  new absolute paths in one shot, and the tab ids must follow. */
const remapPathPrefix = (
  s: { tabs: OpenFile[]; paneRoot: PaneNode; activePaneId: string },
  oldPath: string,
  newPath: string
): { tabs: OpenFile[]; activeTabId: string | null; paneRoot: PaneNode } => {
  if (oldPath === newPath) return { tabs: s.tabs, activeTabId: deriveActiveTabId(s.paneRoot, s.activePaneId), paneRoot: s.paneRoot }
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
  const activeTabId = deriveActiveTabId(paneRoot, s.activePaneId)
  return { tabs, activeTabId, paneRoot }
}

/** Same prefix-rewrite logic as remapPathPrefix, but for diff tab paths. */
const remapDiffTabs = (diffs: DiffTab[], oldPath: string, newPath: string): DiffTab[] => {
  if (oldPath === newPath || diffs.length === 0) return diffs
  const prefix = oldPath + '/'
  const map = (p: string): string =>
    p === oldPath ? newPath : p.startsWith(prefix) ? newPath + p.slice(oldPath.length) : p
  let changed = false
  const next = diffs.map((d) => {
    const l = map(d.leftPath)
    const r = map(d.rightPath)
    if (l === d.leftPath && r === d.rightPath) return d
    changed = true
    return { ...d, leftPath: l, rightPath: r }
  })
  return changed ? next : diffs
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

/** Same prefix-rewrite logic as remapPathPrefix, but for the fileEditorModes
 *  map. Used after a folder rename/move so per-file mode preferences follow
 *  their files. */
const remapFileEditorModes = (
  modes: Record<string, EditorMode>,
  oldPath: string,
  newPath: string
): Record<string, EditorMode> => {
  if (oldPath === newPath) return modes
  const keys = Object.keys(modes)
  if (keys.length === 0) return modes
  const prefix = oldPath + '/'
  let changed = false
  const next: Record<string, EditorMode> = {}
  for (const p of keys) {
    if (p === oldPath) {
      next[newPath] = modes[p]
      changed = true
    } else if (p.startsWith(prefix)) {
      next[newPath + p.slice(oldPath.length)] = modes[p]
      changed = true
    } else {
      next[p] = modes[p]
    }
  }
  return changed ? next : modes
}

/** Rewrite any leaf whose `tabIds` contain `oldTabId` to reference `newTabId`.
 *  Used after rename/move, where the tab's id changes but the pane leaf
 *  still holds the stale id — without this, the pane points at a tab that
 *  no longer exists and the editor falls back to the empty state. */
const remapPaneTabId = (root: PaneNode, oldTabId: string, newTabId: string): PaneNode => {
  if (root.type === 'leaf') {
    const idx = root.tabIds.indexOf(oldTabId)
    if (idx === -1) return root
    const nextTabIds = [...root.tabIds]
    nextTabIds[idx] = newTabId
    return {
      ...root,
      tabIds: nextTabIds,
      activeTabId: root.activeTabId === oldTabId ? newTabId : root.activeTabId
    }
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

// --- Diff/compare view types ---
export type DiffTab = {
  id: string        // e.g. "diff:1", "diff:2"
  leftPath: string  // absolute path — must have a matching tab in `tabs`
  rightPath: string // absolute path — must have a matching tab in `tabs`
}

/** Entry in the "reopen closed tab" stack. */
type ClosedTabEntry =
  | { kind: 'file'; path: string; content: string; savedContent: string }
  | { kind: 'diff'; leftPath: string; rightPath: string }

const MAX_CLOSED_TABS = 20

let diffIdCounter = 0
const nextDiffId = (): string => `diff:${++diffIdCounter}`

/**
 * A transient banner shown near the bottom of the window. Used for
 * non-blocking notices (e.g. a stale recents entry that was auto-removed).
 * A fresh `id` each time lets the component restart its auto-dismiss timer.
 */
export type Toast = {
  id: number
  kind: 'info' | 'error'
  message: string
}

type WorkspaceState = {
  // --- Persistent settings (mirrored from disk) ---
  draftsFolder: string | null
  additionalFolders: string[]
  theme: Theme
  sidebarVisible: boolean
  /** Global fallback mode for files without a per-file override. */
  editorMode: EditorMode
  /**
   * Per-file editor mode overrides, keyed by absolute path. Takes precedence
   * over the global `editorMode`. Persisted so preferences survive restarts.
   */
  fileEditorModes: Record<string, EditorMode>
  recentFiles: string[]
  autoSave: boolean
  autoSaveDelayMs: number
  showWordCount: boolean
  rawHeadingSizes: boolean
  rawWordWrap: boolean
  /** Whether the bottom Variables panel is shown. */
  variablesPanelVisible: boolean

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
  /** ⌘F find/replace bar (per-window, attached to the active pane's editor) */
  findBarOpen: boolean
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
  /**
   * Open tabs (by absolute path) whose file was deleted externally while
   * the tab had unsaved edits. These stay open so the user can Save as…
   * or Discard — the in-editor OrphanBanner renders based on this.
   * Volatile — never persisted.
   */
  orphanedPaths: Set<string>
  /** A close action waiting on the user to resolve unsaved changes. */
  pendingClose: PendingClose | null
  /** Transient bottom-of-window notice (stale file, etc.). Null when hidden. */
  toast: Toast | null
  hydrated: boolean

  // --- Closed tab history (for reopen) ---
  closedTabsStack: ClosedTabEntry[]

  // --- Diff/compare view state ---
  diffTabs: DiffTab[]
  diffPickerOpen: boolean
  diffPickerPrefill: { leftPath?: string } | null

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
  /**
   * Reorder the user's top-level additional folders. Indexes address the
   * `additionalFolders` array, which is the source of truth for sidebar
   * section order (Drafts and Recents are sentinels rendered separately).
   */
  reorderAdditionalFolders: (fromIndex: number, toIndex: number) => Promise<void>

  createSubfolder: (parentPath: string) => Promise<string>
  renameFolder: (oldPath: string, newName: string) => Promise<string>

  /**
   * Open a file as a tab.
   *
   * `source` controls whether the file is promoted in Recents:
   * - `'external'` — request came from outside the app (OS Open With, drag-drop,
   *   File → Open…). The file is added/moved to the top of Recents.
   * - `'navigate'` (default) — user clicked an already-known entry (sidebar,
   *   Recents, Quick Open, palette). Recents order is untouched. Recents
   *   promotion happens later when the user makes the first dirty edit.
   */
  openFile: (path: string, opts?: { source?: 'external' | 'navigate' }) => Promise<void>
  /** Remove a path from the recent files list. */
  removeRecentFile: (path: string) => void
  /** Clear all entries from the recent files list. */
  clearRecentFiles: () => void
  /** Prompt the user for any file and open it (routed through openFile). */
  openFileDialog: () => Promise<void>
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
  /** Save a copy of the active tab to a user-chosen location via system dialog. */
  saveActiveAs: () => Promise<void>
  /** Save a specific tab by id (writes to disk and clears its dirty state). */
  saveTab: (tabId: string) => Promise<void>
  /** Save an orphaned (externally deleted) tab to a user-picked location.
   *  Migrates the tab's path/id to the new location on success. */
  saveOrphanedTabAs: (tabId: string) => Promise<void>
  /** Discard an orphaned tab, dropping its in-memory edits. */
  discardOrphanedTab: (tabId: string) => void

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
  toggleVariablesPanel: () => Promise<void>
  setVariablesPanelVisible: (visible: boolean) => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  openQuickOpen: () => void
  closeQuickOpen: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  openShortcuts: () => void
  closeShortcuts: () => void
  openFindBar: () => void
  closeFindBar: () => void
  saveScrollPosition: (tabId: string, value: number | { line: number; offsetPx: number }) => void
  saveCursorPosition: (tabId: string, anchor: number, head: number) => void
  startRenamingTab: () => void
  cancelRenamingTab: () => void
  toggleSidebarCollapsedPath: (path: string) => void
  expandSidebarPaths: (...paths: string[]) => void
  collapseSidebarPath: (path: string) => void

  setUpdateStatus: (status: UpdateStatus) => void
  checkForUpdates: () => Promise<void>

  /** Show a transient notice at the bottom of the window. */
  showToast: (message: string, kind?: 'info' | 'error') => void
  /** Hide the current toast if any. */
  dismissToast: () => void

  // --- Reopen closed tab ---
  reopenClosedTab: () => Promise<void>

  // --- Diff/compare view actions ---
  openDiffPicker: (prefill?: { leftPath?: string }) => void
  closeDiffPicker: () => void
  openDiff: (leftPath: string, rightPath: string) => Promise<void>
  closeDiffTab: (diffId: string) => void
  swapDiffSides: (diffId: string) => void
  replaceDiffFile: (diffId: string, side: 'left' | 'right', newPath: string) => Promise<void>
}

const MAX_RECENT_FILES = 50

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

/**
 * Resolve the effective editor mode for a given file path:
 * per-file override if one exists, otherwise the global default.
 * Exported so components can read it without duplicating the fallback rule.
 */
export const resolveEditorMode = (
  path: string | null | undefined,
  fileEditorModes: Record<string, EditorMode>,
  globalMode: EditorMode
): EditorMode => (path && fileEditorModes[path] ? fileEditorModes[path] : globalMode)

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
  fileEditorModes: {},
  recentFiles: [],
  autoSave: false,
  autoSaveDelayMs: 1500,
  showWordCount: false,
  rawHeadingSizes: false,
  rawWordWrap: true,
  variablesPanelVisible: false,

  sections: [],
  moveTargets: [],
  moveTargetsLoading: false,
  tabs: [],
  activeTabId: null,
  paneRoot: { type: 'leaf', id: 'root', tabIds: [], activeTabId: null },
  activePaneId: 'root',
  updateStatus: { kind: 'idle' },
  settingsOpen: false,
  quickOpenOpen: false,
  commandPaletteOpen: false,
  shortcutsOpen: false,
  findBarOpen: false,
  renamingTabId: null,
  scrollPositions: {},
  cursorPositions: {},
  sidebarCollapsedPaths: new Set<string>(),
  autoNamedPaths: new Set<string>(),
  autoRenameInFlight: new Set<string>(),
  orphanedPaths: new Set<string>(),
  pendingClose: null,
  toast: null,
  hydrated: false,

  closedTabsStack: [],
  diffTabs: [],
  diffPickerOpen: false,
  diffPickerPrefill: null,

  hydrate: async () => {
    const settings = await window.api.loadSettings()
    set({
      draftsFolder: settings.draftsFolder,
      additionalFolders: settings.additionalFolders,
      theme: settings.theme,
      sidebarVisible: settings.sidebarVisible,
      editorMode: settings.editorMode,
      fileEditorModes: settings.fileEditorModes ?? {},
      recentFiles: settings.recentFiles ?? [],
      autoSave: settings.autoSave ?? false,
      autoSaveDelayMs: settings.autoSaveDelayMs ?? 1500,
      showWordCount: settings.showWordCount ?? false,
      rawHeadingSizes: settings.rawHeadingSizes ?? false,
      rawWordWrap: settings.rawWordWrap ?? true,
      variablesPanelVisible: settings.variablesPanelVisible ?? false,
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
      paneRoot: {
        type: 'leaf',
        id: 'root',
        tabIds: restoredTabs.map((t) => t.id),
        activeTabId
      },
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
    const { sections, autoRenameInFlight } = get()
    const parent =
      sections.find((sec) => sec.path === payload.folder) ??
      sections.find((sec) => sec.isDrafts && sec.path === payload.folder)
    if (parent) {
      await get().refreshSection(parent.id)
    }

    for (const evt of payload.events) {
      // Suppress events for paths we're renaming ourselves — the unlink/add
      // half of our own rename would otherwise close or duplicate the tab.
      if (autoRenameInFlight.has(evt.path)) continue
      if (evt.type === 'rename' && evt.fromPath && autoRenameInFlight.has(evt.fromPath)) continue

      if (evt.type === 'rename' && evt.fromPath) {
        // Inode-correlated rename from the watcher: silently migrate any
        // open tab's path/id, then surface a small toast so the user knows
        // why the tab title changed.
        const oldPath = evt.fromPath
        const newPath = evt.path
        const tab = get().tabs.find((t) => t.path === oldPath)
        if (!tab) continue

        // Any pending deferred reload was keyed by the old path — cancel it;
        // the rename effectively replaces the file's identity.
        cancelPendingReload(oldPath)

        const newName = newPath.split('/').pop() ?? tab.name
        set((s) => {
          const nextTabs = s.tabs.map((t) =>
            t.path === oldPath ? { ...t, id: newPath, path: newPath, name: newName } : t
          )
          const nextPane = remapPaneTabId(s.paneRoot, oldPath, newPath)

          const nextScroll = { ...s.scrollPositions }
          if (oldPath in nextScroll) {
            nextScroll[newPath] = nextScroll[oldPath]
            delete nextScroll[oldPath]
          }
          const nextCursor = { ...s.cursorPositions }
          if (oldPath in nextCursor) {
            nextCursor[newPath] = nextCursor[oldPath]
            delete nextCursor[oldPath]
          }
          const nextRecent = s.recentFiles.map((p) => (p === oldPath ? newPath : p))
          const nextAutoNamed = new Set(s.autoNamedPaths)
          if (nextAutoNamed.has(oldPath)) {
            nextAutoNamed.delete(oldPath)
            nextAutoNamed.add(newPath)
          }
          const nextModes = { ...s.fileEditorModes }
          if (oldPath in nextModes) {
            nextModes[newPath] = nextModes[oldPath]
            delete nextModes[oldPath]
          }
          const nextOrphans = new Set(s.orphanedPaths)
          if (nextOrphans.has(oldPath)) {
            nextOrphans.delete(oldPath)
            nextOrphans.add(newPath)
          }
          return {
            tabs: nextTabs,
            activeTabId: deriveActiveTabId(nextPane, s.activePaneId),
            paneRoot: nextPane,
            scrollPositions: nextScroll,
            cursorPositions: nextCursor,
            recentFiles: nextRecent,
            autoNamedPaths: nextAutoNamed,
            fileEditorModes: nextModes,
            orphanedPaths: nextOrphans
          }
        })
        void persistSettings({
          autoNamedPaths: Array.from(get().autoNamedPaths),
          recentFiles: get().recentFiles,
          fileEditorModes: get().fileEditorModes
        })

        // Move any module-level bookkeeping keyed by tab id.
        if (lastTypedAt.has(oldPath)) {
          const v = lastTypedAt.get(oldPath)!
          lastTypedAt.delete(oldPath)
          lastTypedAt.set(newPath, v)
        }

        const oldName = oldPath.split('/').pop() ?? oldPath
        get().showToast(`${oldName} → ${newName}`)
      } else if (evt.type === 'unlink') {
        const tab = get().tabs.find((t) => t.path === evt.path)
        if (!tab) continue
        cancelPendingReload(evt.path)
        const dirty = tab.content !== tab.savedContent
        if (dirty) {
          // Keep the tab open so the user can Save as… or Discard. The
          // OrphanBanner renders based on `orphanedPaths`, and autosave
          // is suppressed for orphaned paths (see useAutoSave).
          set((s) => {
            const next = new Set(s.orphanedPaths)
            next.add(evt.path)
            return { orphanedPaths: next }
          })
        } else {
          // Clean tab — silently close and tell the user why.
          const name = tab.name
          get().closeTab(tab.id)
          lastTypedAt.delete(evt.path)
          get().showToast(`${name} was deleted externally`)
        }
      } else if (evt.type === 'change') {
        // Silent auto-reload — runs for both clean and dirty tabs. `doReload`
        // handles self-write suppression (content already matches disk) and
        // defers the apply if the user typed very recently.
        void doReload(evt.path)
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

  reorderAdditionalFolders: async (fromIndex, toIndex) => {
    const folders = get().additionalFolders
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= folders.length ||
      toIndex >= folders.length ||
      fromIndex === toIndex
    ) {
      return
    }
    const next = [...folders]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    // Reorder the live sections to match — Drafts is pinned at index 0, so
    // the additional folders start at index 1. Reshuffling by id keeps each
    // section's already-loaded tree intact (no flicker or re-read from disk).
    set((s) => {
      const byId = new Map(s.sections.map((sec) => [sec.id, sec]))
      const drafts = s.sections.find((sec) => sec.isDrafts)
      const reorderedExtras = next
        .map((p) => byId.get(p))
        .filter((sec): sec is SidebarSection => sec !== undefined)
      return {
        additionalFolders: next,
        sections: drafts ? [drafts, ...reorderedExtras] : reorderedExtras
      }
    })
    await persistSettings({ additionalFolders: next })
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
      const nextModes = remapFileEditorModes(s.fileEditorModes, oldPath, newPath)
      const nextDiffs = remapDiffTabs(s.diffTabs, oldPath, newPath)
      return { ...remapped, autoNamedPaths: nextAutoNamed, fileEditorModes: nextModes, diffTabs: nextDiffs }
    })
    void persistSettings({
      autoNamedPaths: Array.from(get().autoNamedPaths),
      fileEditorModes: get().fileEditorModes
    })
    await get().refreshAllSections()
    void get().refreshMoveTargets()
    return newPath
  },

  openFile: async (path, opts) => {
    const source = opts?.source ?? 'navigate'
    const shouldBump = source === 'external'

    const existing = get().tabs.find((t) => t.path === path)
    if (existing) {
      if (shouldBump) bumpRecentFile(path)
      get().setActiveTab(existing.id)
      return
    }

    // Try to read before mutating state so a stale path (file deleted since
    // it landed in recents) doesn't linger in the list. If the read fails
    // we drop the entry from recents and surface a toast.
    let content: string
    let name: string
    try {
      content = await window.api.readFile(path)
      name = await window.api.basename(path)
    } catch {
      const prev = get().recentFiles
      if (prev.includes(path)) {
        const next = prev.filter((p) => p !== path)
        set({ recentFiles: next })
        void persistSettings({ recentFiles: next })
      }
      const basename = path.split('/').pop() || path
      get().showToast(`Can't open “${basename}” — file no longer exists`, 'error')
      return
    }

    if (shouldBump) bumpRecentFile(path)
    const tab: OpenFile = {
      id: path,
      path,
      name,
      content,
      savedContent: content
    }
    const { paneRoot, activePaneId } = get()
    const activeLeaf = findLeafById(paneRoot, activePaneId)
    if (!activeLeaf) return
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
      paneRoot: replaceNode(paneRoot, activePaneId, {
        ...activeLeaf,
        tabIds: [...activeLeaf.tabIds, tab.id],
        activeTabId: tab.id
      })
    }))
  },

  removeRecentFile: (path) => {
    const prev = get().recentFiles
    if (!prev.includes(path)) return
    const next = prev.filter((p) => p !== path)
    set({ recentFiles: next })
    void persistSettings({ recentFiles: next })
  },

  clearRecentFiles: () => {
    if (get().recentFiles.length === 0) return
    set({ recentFiles: [] })
    void persistSettings({ recentFiles: [] })
  },

  openFileDialog: async () => {
    const chosen = await window.api.openFile()
    // File → Open… is an external request to open a specific file; always
    // promote it in Recents regardless of whether it's already open.
    if (chosen) await get().openFile(chosen, { source: 'external' })
  },

  createDraft: async () => {
    const { draftsFolder, openSettings } = get()
    if (!draftsFolder) {
      openSettings()
      return
    }
    // Capture the active tab's effective mode BEFORE we change the active
    // tab by opening the draft — the new file should inherit the mode of
    // the file the user was in when they triggered "new".
    const { activeTabId, tabs, fileEditorModes, editorMode } = get()
    const sourceTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : undefined
    const inheritedMode = resolveEditorMode(sourceTab?.path, fileEditorModes, editorMode)

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const newPath = await window.api.createFile(draftsFolder, `untitled-${timestamp}.md`)
    // Mark as auto-named so the next non-empty line typed becomes the filename.
    const nextAutoNamed = new Set(get().autoNamedPaths)
    nextAutoNamed.add(newPath)
    // Record the inherited mode so the draft opens the same way as its source.
    const nextModes: Record<string, EditorMode> = {
      ...get().fileEditorModes,
      [newPath]: inheritedMode
    }
    set({ autoNamedPaths: nextAutoNamed, fileEditorModes: nextModes })
    void persistSettings({
      autoNamedPaths: Array.from(nextAutoNamed),
      fileEditorModes: nextModes
    })
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
      const nextPane = remapPaneTabId(s.paneRoot, oldPath, renamedPath)
      const nextActive = deriveActiveTabId(nextPane, s.activePaneId)

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

      const nextModes = { ...s.fileEditorModes }
      if (oldPath in nextModes) {
        nextModes[renamedPath] = nextModes[oldPath]
        delete nextModes[oldPath]
      }

      return {
        tabs: nextTabs,
        activeTabId: nextActive,
        paneRoot: nextPane,
        scrollPositions: nextScroll,
        cursorPositions: nextCursor,
        recentFiles: nextRecent,
        autoNamedPaths: nextAutoNamed,
        fileEditorModes: nextModes
      }
    })

    void persistSettings({
      autoNamedPaths: Array.from(get().autoNamedPaths),
      recentFiles: get().recentFiles,
      fileEditorModes: get().fileEditorModes
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
      const nextModes = { ...s.fileEditorModes }
      if (oldPath in nextModes) {
        nextModes[newPath] = nextModes[oldPath]
        delete nextModes[oldPath]
      }
      const nextPane = remapPaneTabId(s.paneRoot, oldPath, newPath)
      return {
        tabs: s.tabs.map((t) =>
          t.path === oldPath ? { ...t, id: newPath, path: newPath, name: safeName } : t
        ),
        activeTabId: deriveActiveTabId(nextPane, s.activePaneId),
        paneRoot: nextPane,
        renamingTabId: s.renamingTabId === oldPath ? null : s.renamingTabId,
        autoNamedPaths: nextAutoNamed,
        fileEditorModes: nextModes,
        diffTabs: remapDiffTabs(s.diffTabs, oldPath, newPath),
      }
    })
    void persistSettings({
      autoNamedPaths: Array.from(get().autoNamedPaths),
      fileEditorModes: get().fileEditorModes
    })
    await get().refreshAllSections()
  },

  deleteFile: async (path) => {
    await window.api.deletePath(path)
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path)
      const nextAutoNamed = new Set(s.autoNamedPaths)
      nextAutoNamed.delete(path)
      const nextModes =
        path in s.fileEditorModes
          ? Object.fromEntries(Object.entries(s.fileEditorModes).filter(([k]) => k !== path))
          : s.fileEditorModes
      if (idx === -1) return { autoNamedPaths: nextAutoNamed, fileEditorModes: nextModes }
      const nextTabs = s.tabs.filter((t) => t.path !== path)
      // Remove from all panes
      const removeFromPanes = (node: PaneNode): PaneNode => {
        if (node.type === 'leaf') {
          if (!node.tabIds.includes(path)) return node
          const nextTabIds = node.tabIds.filter((id) => id !== path)
          let nextActiveTabId = node.activeTabId
          if (node.activeTabId === path) {
            const oldIdx = node.tabIds.indexOf(path)
            nextActiveTabId = nextTabIds.length > 0
              ? nextTabIds[Math.min(oldIdx, nextTabIds.length - 1)]
              : null
          }
          return { ...node, tabIds: nextTabIds, activeTabId: nextActiveTabId }
        }
        return {
          ...node,
          children: [removeFromPanes(node.children[0]), removeFromPanes(node.children[1])] as [PaneNode, PaneNode]
        }
      }
      const nextPane = removeFromPanes(s.paneRoot)
      return {
        tabs: nextTabs,
        activeTabId: deriveActiveTabId(nextPane, s.activePaneId),
        paneRoot: nextPane,
        autoNamedPaths: nextAutoNamed,
        fileEditorModes: nextModes
      }
    })
    void persistSettings({
      autoNamedPaths: Array.from(get().autoNamedPaths),
      fileEditorModes: get().fileEditorModes
    })
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
      const nextModes = { ...s.fileEditorModes }
      if (path in nextModes) {
        nextModes[newPath] = nextModes[path]
        delete nextModes[path]
      }
      const nextPane = remapPaneTabId(s.paneRoot, path, newPath)
      return {
        tabs: s.tabs.map((t) =>
          t.path === path
            ? { ...t, id: newPath, path: newPath, name: newPath.split('/').pop() ?? t.name }
            : t
        ),
        activeTabId: deriveActiveTabId(nextPane, s.activePaneId),
        paneRoot: nextPane,
        autoNamedPaths: nextAutoNamed,
        fileEditorModes: nextModes
      }
    })
    void persistSettings({
      autoNamedPaths: Array.from(get().autoNamedPaths),
      fileEditorModes: get().fileEditorModes
    })
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
      const nextModes = remapFileEditorModes(s.fileEditorModes, path, newPath)
      const nextDiffs = remapDiffTabs(s.diffTabs, path, newPath)
      return { ...remapped, autoNamedPaths: nextAutoNamed, fileEditorModes: nextModes, diffTabs: nextDiffs }
    })
    void persistSettings({
      autoNamedPaths: Array.from(get().autoNamedPaths),
      fileEditorModes: get().fileEditorModes
    })
    await get().refreshAllSections()
    void get().refreshMoveTargets()
  },

  setActiveTab: (id) => {
    const { paneRoot, activePaneId } = get()
    const activeLeaf = findLeafById(paneRoot, activePaneId)

    // If the tab is in the active pane, just switch to it
    if (activeLeaf && activeLeaf.tabIds.includes(id)) {
      set({
        activeTabId: id,
        paneRoot: replaceNode(paneRoot, activePaneId, {
          ...activeLeaf,
          activeTabId: id
        })
      })
      return
    }

    // If a different pane has this tab, focus that pane
    const existingLeaf = findLeafByTabId(paneRoot, id)
    if (existingLeaf) {
      set({
        activeTabId: id,
        activePaneId: existingLeaf.id,
        paneRoot: replaceNode(paneRoot, existingLeaf.id, {
          ...existingLeaf,
          activeTabId: id
        })
      })
      return
    }

    // Tab not in any pane — add it to the active pane
    if (activeLeaf) {
      set({
        activeTabId: id,
        paneRoot: replaceNode(paneRoot, activePaneId, {
          ...activeLeaf,
          tabIds: [...activeLeaf.tabIds, id],
          activeTabId: id
        })
      })
    }
  },

  closeTab: (id) => {
    // Clean up module-level bookkeeping keyed by path.
    const closing = get().tabs.find((t) => t.id === id)
    if (closing) {
      cancelPendingReload(closing.path)
      lastTypedAt.delete(closing.path)
    }
    // Push to closed-tabs stack (skip drafts — they can't be reopened)
    if (closing && !closing.path.startsWith('draft://')) {
      const entry: ClosedTabEntry = {
        kind: 'file',
        path: closing.path,
        content: closing.content,
        savedContent: closing.savedContent,
      }
      set((s) => ({
        closedTabsStack: [entry, ...s.closedTabsStack].slice(0, MAX_CLOSED_TABS),
      }))
    }
    set((s) => {
      // Remove tab from every pane's tabIds, pick neighbor as next active per pane
      const removingIds = new Set([id])
      const nextDiffTabs = s.diffTabs

      const updatePaneTree = (node: PaneNode): PaneNode => {
        if (node.type === 'leaf') {
          const hadAny = node.tabIds.some((tid) => removingIds.has(tid))
          if (!hadAny) return node
          const nextTabIds = node.tabIds.filter((tid) => !removingIds.has(tid))
          let nextActiveTabId = node.activeTabId
          if (node.activeTabId && removingIds.has(node.activeTabId)) {
            const oldIdx = node.tabIds.indexOf(node.activeTabId)
            nextActiveTabId = nextTabIds.length > 0
              ? nextTabIds[Math.min(oldIdx, nextTabIds.length - 1)]
              : null
          }
          return { ...node, tabIds: nextTabIds, activeTabId: nextActiveTabId }
        }
        return {
          ...node,
          children: [updatePaneTree(node.children[0]), updatePaneTree(node.children[1])] as [
            PaneNode,
            PaneNode
          ]
        }
      }

      const updatedPaneRoot = updatePaneTree(s.paneRoot)

      // Auto-collapse empty panes in splits (so closing the last tab in a
      // pane removes the pane automatically)
      const nextPaneRoot = collapseEmptyPanes(updatedPaneRoot)

      // If the active pane was collapsed away, fall back to the first leaf
      let nextActivePaneId = s.activePaneId
      if (!findLeafById(nextPaneRoot, nextActivePaneId)) {
        const leafIds = collectLeafIds(nextPaneRoot)
        nextActivePaneId = leafIds[0] ?? 'root'
      }

      // GC: remove from tabs[] if no pane or diff tab references it
      const stillReferenced = collectAllPaneTabIds(nextPaneRoot)
      // Keep tabs that are used by any remaining diff tab
      for (const dt of nextDiffTabs) {
        const leftTab = s.tabs.find((t) => t.path === dt.leftPath)
        const rightTab = s.tabs.find((t) => t.path === dt.rightPath)
        if (leftTab) stillReferenced.add(leftTab.id)
        if (rightTab) stillReferenced.add(rightTab.id)
      }
      const nextTabs = s.tabs.filter((t) => stillReferenced.has(t.id))

      // Derive new global activeTabId from the active pane
      const nextActive = deriveActiveTabId(nextPaneRoot, nextActivePaneId)

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...restScroll } = s.scrollPositions
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _c, ...restCursor } = s.cursorPositions
      let nextOrphans = s.orphanedPaths
      if (closing && s.orphanedPaths.has(closing.path)) {
        nextOrphans = new Set(s.orphanedPaths)
        nextOrphans.delete(closing.path)
      }
      return {
        tabs: nextTabs,
        activeTabId: nextActive,
        activePaneId: nextActivePaneId,
        paneRoot: nextPaneRoot,
        scrollPositions: restScroll,
        cursorPositions: restCursor,
        orphanedPaths: nextOrphans,
        diffTabs: nextDiffTabs,
      }
    })
  },

  closeOtherTabs: (id) =>
    set((s) => {
      const keep = s.tabs.find((t) => t.id === id)
      if (!keep) return s
      // In the active pane, keep only the specified tab. Other panes are cleared.
      const updatePaneTree = (node: PaneNode): PaneNode => {
        if (node.type === 'leaf') {
          if (node.tabIds.includes(id)) {
            return { ...node, tabIds: [id], activeTabId: id }
          }
          return { ...node, tabIds: [], activeTabId: null }
        }
        return {
          ...node,
          children: [updatePaneTree(node.children[0]), updatePaneTree(node.children[1])] as [PaneNode, PaneNode]
        }
      }
      const nextPaneRoot = updatePaneTree(s.paneRoot)
      const keptScroll = s.scrollPositions[id]
      const keptCursor = s.cursorPositions[id]
      return {
        tabs: [keep],
        activeTabId: keep.id,
        paneRoot: nextPaneRoot,
        diffTabs: [],
        scrollPositions: keptScroll !== undefined ? { [id]: keptScroll } : {},
        cursorPositions: keptCursor !== undefined ? { [id]: keptCursor } : {}
      }
    }),

  closeAllTabs: () =>
    set((s) => {
      const clearPanes = (node: PaneNode): PaneNode => {
        if (node.type === 'leaf') return { ...node, tabIds: [], activeTabId: null }
        return {
          ...node,
          children: [clearPanes(node.children[0]), clearPanes(node.children[1])] as [PaneNode, PaneNode]
        }
      }
      return {
        tabs: [],
        activeTabId: null,
        paneRoot: clearPanes(s.paneRoot),
        diffTabs: [],
        scrollPositions: {},
        cursorPositions: {}
      }
    }),

  reorderTabs: (fromIndex, toIndex) =>
    set((s) => {
      const leaf = findLeafById(s.paneRoot, s.activePaneId)
      if (!leaf) return s
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= leaf.tabIds.length ||
        toIndex >= leaf.tabIds.length ||
        fromIndex === toIndex
      ) {
        return s
      }
      const next = [...leaf.tabIds]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return {
        paneRoot: replaceNode(s.paneRoot, s.activePaneId, { ...leaf, tabIds: next })
      }
    }),

  updateActiveContent: (content) =>
    set((s) => {
      const activeId = deriveActiveTabId(s.paneRoot, s.activePaneId)
      if (!activeId) return s
      return {
        tabs: s.tabs.map((t) => (t.id === activeId ? { ...t, content } : t))
      }
    }),

  saveActive: async () => {
    const { tabs, activeTabId } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    if (tab.content === tab.savedContent) return
    // Cancel any deferred external reload — our write will otherwise race
    // with it and either clobber the user's buffer or reload stale content.
    cancelPendingReload(tab.path)
    await window.api.writeFile(tab.path, tab.content)
    set((s) => {
      const next: Partial<WorkspaceState> = {
        tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, savedContent: tab.content } : t))
      }
      if (s.orphanedPaths.has(tab.path)) {
        const nextOrphans = new Set(s.orphanedPaths)
        nextOrphans.delete(tab.path)
        next.orphanedPaths = nextOrphans
      }
      return next as Partial<WorkspaceState>
    })
    const sections = get().sections
    const parent = sections.find((sec) => sectionContainsFile(sec, tab.path))
    if (parent) await get().refreshSection(parent.id)
  },

  saveActiveAs: async () => {
    const { tabs, activeTabId, openFile } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    // Pass the full path so the system dialog opens in the enclosing folder
    const chosen = await window.api.saveFileDialog(tab.path)
    if (!chosen) return
    await window.api.writeFile(chosen, tab.content)
    void openFile(chosen)
  },

  saveTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.content === tab.savedContent) return
    const pending = tab.content
    cancelPendingReload(tab.path)
    await window.api.writeFile(tab.path, pending)
    set((s) => {
      const next: Partial<WorkspaceState> = {
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, savedContent: pending } : t))
      }
      if (s.orphanedPaths.has(tab.path)) {
        const nextOrphans = new Set(s.orphanedPaths)
        nextOrphans.delete(tab.path)
        next.orphanedPaths = nextOrphans
      }
      return next as Partial<WorkspaceState>
    })
  },

  saveOrphanedTabAs: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    const chosen = await window.api.saveFileDialog(tab.name)
    if (!chosen) return
    cancelPendingReload(tab.path)
    await window.api.writeFile(chosen, tab.content)
    const oldPath = tab.path
    const newName = chosen.split('/').pop() ?? tab.name
    set((s) => {
      const nextTabs = s.tabs.map((t) =>
        t.path === oldPath
          ? { ...t, id: chosen, path: chosen, name: newName, savedContent: tab.content }
          : t
      )
      const nextPane = remapPaneTabId(s.paneRoot, oldPath, chosen)
      const nextActive = deriveActiveTabId(nextPane, s.activePaneId)
      const nextOrphans = new Set(s.orphanedPaths)
      nextOrphans.delete(oldPath)
      const nextScroll = { ...s.scrollPositions }
      if (oldPath in nextScroll) {
        nextScroll[chosen] = nextScroll[oldPath]
        delete nextScroll[oldPath]
      }
      const nextCursor = { ...s.cursorPositions }
      if (oldPath in nextCursor) {
        nextCursor[chosen] = nextCursor[oldPath]
        delete nextCursor[oldPath]
      }
      return {
        tabs: nextTabs,
        activeTabId: nextActive,
        paneRoot: nextPane,
        orphanedPaths: nextOrphans,
        scrollPositions: nextScroll,
        cursorPositions: nextCursor
      }
    })
    if (lastTypedAt.has(oldPath)) {
      lastTypedAt.delete(oldPath)
    }
    await get().refreshAllSections()
  },

  discardOrphanedTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    cancelPendingReload(tab.path)
    lastTypedAt.delete(tab.path)
    // Route through closeTab which handles pane cleanup and GC
    get().closeTab(tabId)
    set((s) => {
      const nextOrphans = new Set(s.orphanedPaths)
      nextOrphans.delete(tab.path)
      return { orphanedPaths: nextOrphans }
    })
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
      // If this was a window-close prompt (red X, Cmd+Q), tell main the user
      // backed out — main needs to clear its "quit in flight" flag so a later
      // Cmd+W on the last window doesn't unexpectedly terminate the app.
      if (pc.kind === 'window') {
        void window.api.cancelClose()
      }
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
    const newLeaf: LeafPane = {
      type: 'leaf',
      id: newLeafId,
      tabIds: tabId ? [tabId] : [],
      activeTabId: tabId
    }
    const replacement: SplitPane = {
      type: 'split',
      id: nextPaneId(),
      direction,
      children: [{ ...target }, newLeaf],
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
      set({
        paneRoot: { ...paneRoot, tabIds: [], activeTabId: null },
        activeTabId: null
      })
      // GC tabs no longer referenced by any pane
      set((s) => {
        const referenced = collectAllPaneTabIds(s.paneRoot)
        return { tabs: s.tabs.filter((t) => referenced.has(t.id)) }
      })
      return
    }
    const parent = findParent(paneRoot, paneId)
    if (!parent) return
    const sibling = parent.children[0].id === paneId ? parent.children[1] : parent.children[0]
    const newRoot = replaceNode(paneRoot, parent.id, sibling)
    const leaves = collectLeafIds(sibling)
    const newActivePaneId = leaves[0] ?? 'root'
    const newActiveLeaf = findLeafById(newRoot, newActivePaneId)
    const newActiveTabId = newActiveLeaf?.activeTabId ?? get().activeTabId
    set({
      paneRoot: newRoot,
      activePaneId: newActivePaneId,
      activeTabId: newActiveTabId ?? get().activeTabId
    })
    // GC tabs no longer referenced by any pane
    set((s) => {
      const referenced = collectAllPaneTabIds(s.paneRoot)
      return { tabs: s.tabs.filter((t) => referenced.has(t.id)) }
    })
  },

  setActivePane: (paneId) => {
    const { paneRoot } = get()
    const leaf = findLeafById(paneRoot, paneId)
    if (!leaf) return
    set({ activePaneId: paneId, activeTabId: leaf.activeTabId ?? get().activeTabId })
  },

  setPaneTab: (paneId, tabId) => {
    const { paneRoot } = get()
    const leaf = findLeafById(paneRoot, paneId)
    if (!leaf) return
    // Add the tab to the pane's tab list if not already there, and make it active
    const nextTabIds = leaf.tabIds.includes(tabId) ? leaf.tabIds : [...leaf.tabIds, tabId]
    set({
      paneRoot: replaceNode(paneRoot, paneId, { ...leaf, tabIds: nextTabIds, activeTabId: tabId }),
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

  updateTabContent: (tabId, content) => {
    let bumpPath: string | null = null
    set((s) => {
      const tab = s.tabs.find((t) => t.id === tabId)
      // Only record a typing timestamp when content actually changed —
      // otherwise a no-op setContent from reconciliation would defer the
      // very reload that just ran.
      if (tab && tab.content !== content) {
        lastTypedAt.set(tab.path, Date.now())
        // A real user edit: promote this file in Recents. If it's already
        // at the top (or would be after dedup), `bumpRecentFile` is a no-op.
        bumpPath = tab.path
      }
      return {
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, content } : t))
      }
    })
    if (bumpPath) bumpRecentFile(bumpPath)
  },

  toggleSidebar: async () => {
    const next = !get().sidebarVisible
    set({ sidebarVisible: next })
    await persistSettings({ sidebarVisible: next })
  },

  setEditorMode: async (mode) => {
    // Per-file preference: record the mode against the active tab's path so
    // switching here doesn't affect other tabs. If there's no active tab,
    // treat the switch as a change to the global default instead.
    const { activeTabId, tabs, fileEditorModes, editorMode } = get()
    const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : undefined
    if (activeTab) {
      if (fileEditorModes[activeTab.path] === mode) return
      const nextModes = { ...fileEditorModes, [activeTab.path]: mode }
      set({ fileEditorModes: nextModes })
      await persistSettings({ fileEditorModes: nextModes })
      return
    }
    if (editorMode === mode) return
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

  toggleVariablesPanel: async () => {
    const next = !get().variablesPanelVisible
    set({ variablesPanelVisible: next })
    await persistSettings({ variablesPanelVisible: next })
  },

  setVariablesPanelVisible: async (visible) => {
    if (get().variablesPanelVisible === visible) return
    set({ variablesPanelVisible: visible })
    await persistSettings({ variablesPanelVisible: visible })
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openQuickOpen: () => set({ quickOpenOpen: true, commandPaletteOpen: false }),
  closeQuickOpen: () => set({ quickOpenOpen: false }),
  openCommandPalette: () => set({ commandPaletteOpen: true, quickOpenOpen: false }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  openShortcuts: () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
  openFindBar: () => set({ findBarOpen: true }),
  closeFindBar: () => set({ findBarOpen: false }),
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
  },

  showToast: (message, kind = 'info') => {
    // A fresh id each time lets the Toast component restart its
    // auto-dismiss timer even when an existing toast is still on screen.
    set({ toast: { id: ++toastIdCounter, kind, message } })
  },

  dismissToast: () => {
    if (get().toast) set({ toast: null })
  },

  // --- Reopen closed tab ---

  reopenClosedTab: async () => {
    const { closedTabsStack } = get()
    if (closedTabsStack.length === 0) return

    const [entry, ...rest] = closedTabsStack
    set({ closedTabsStack: rest })

    if (entry.kind === 'file') {
      // Check if already open
      const existing = get().tabs.find((t) => t.path === entry.path)
      if (existing) {
        get().setActiveTab(existing.id)
        return
      }
      // Try to read the current content from disk; fall back to the snapshot
      let content = entry.content
      let savedContent = entry.savedContent
      let name: string
      try {
        content = await window.api.readFile(entry.path)
        savedContent = content
        name = await window.api.basename(entry.path)
      } catch {
        // File was deleted — restore from snapshot with dirty state
        name = entry.path.split('/').pop() ?? entry.path
      }
      const tab: OpenFile = { id: entry.path, path: entry.path, name, content, savedContent }
      const { paneRoot, activePaneId } = get()
      const activeLeaf = findLeafById(paneRoot, activePaneId)
      if (!activeLeaf) return
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        paneRoot: replaceNode(s.paneRoot, activePaneId, {
          ...activeLeaf,
          tabIds: [...activeLeaf.tabIds, tab.id],
          activeTabId: tab.id,
        }),
      }))
    } else {
      // Reopen a diff tab
      await get().openDiff(entry.leftPath, entry.rightPath)
    }
  },

  // --- Diff/compare view actions ---

  openDiffPicker: (prefill) => {
    set({ diffPickerOpen: true, diffPickerPrefill: prefill ?? null })
  },

  closeDiffPicker: () => {
    set({ diffPickerOpen: false, diffPickerPrefill: null })
  },

  openDiff: async (leftPath, rightPath) => {
    // Load files into the tabs pool (so DiffView can read their content)
    // but DON'T add them to any pane's tabIds — only the diff tab is visible.
    const loadIntoPool = async (path: string): Promise<void> => {
      if (get().tabs.find((t) => t.path === path)) return
      let content: string
      let name: string
      try {
        content = await window.api.readFile(path)
        name = await window.api.basename(path)
      } catch {
        const basename = path.split('/').pop() || path
        get().showToast(`Can't open "${basename}" — file no longer exists`, 'error')
        return
      }
      const tab: OpenFile = { id: path, path, name, content, savedContent: content }
      set((s) => ({ tabs: [...s.tabs, tab] }))
    }

    await loadIntoPool(leftPath)
    await loadIntoPool(rightPath)

    const diffId = nextDiffId()
    const diffTab: DiffTab = { id: diffId, leftPath, rightPath }

    // Add only the diff tab to the active pane
    const { paneRoot, activePaneId } = get()
    const activeLeaf = findLeafById(paneRoot, activePaneId)
    if (!activeLeaf) return
    set((s) => ({
      diffTabs: [...s.diffTabs, diffTab],
      activeTabId: diffId,
      paneRoot: replaceNode(s.paneRoot, activePaneId, {
        ...activeLeaf,
        tabIds: [...activeLeaf.tabIds, diffId],
        activeTabId: diffId
      }),
      diffPickerOpen: false,
      diffPickerPrefill: null,
    }))
  },

  closeDiffTab: (diffId) => {
    const { diffTabs } = get()
    const dt = diffTabs.find((d) => d.id === diffId)
    if (!dt) return

    // Push to closed-tabs stack
    const entry: ClosedTabEntry = { kind: 'diff', leftPath: dt.leftPath, rightPath: dt.rightPath }
    set((s) => ({
      closedTabsStack: [entry, ...s.closedTabsStack].slice(0, MAX_CLOSED_TABS),
    }))

    set((s) => {
      // Remove the diff tab from every pane's tabIds
      const removeFromPanes = (node: PaneNode): PaneNode => {
        if (node.type === 'leaf') {
          if (!node.tabIds.includes(diffId)) return node
          const nextTabIds = node.tabIds.filter((id) => id !== diffId)
          let nextActiveTabId = node.activeTabId
          if (node.activeTabId === diffId) {
            const oldIdx = node.tabIds.indexOf(diffId)
            nextActiveTabId = nextTabIds.length > 0
              ? nextTabIds[Math.min(oldIdx, nextTabIds.length - 1)]
              : null
          }
          return { ...node, tabIds: nextTabIds, activeTabId: nextActiveTabId }
        }
        return {
          ...node,
          children: [removeFromPanes(node.children[0]), removeFromPanes(node.children[1])] as [PaneNode, PaneNode]
        }
      }
      const updatedPaneRoot = removeFromPanes(s.paneRoot)
      const nextPaneRoot = collapseEmptyPanes(updatedPaneRoot)
      const nextDiffTabs = s.diffTabs.filter((d) => d.id !== diffId)

      // GC: remove source-file tabs that are no longer in any pane or diff
      const stillReferenced = collectAllPaneTabIds(nextPaneRoot)
      for (const d of nextDiffTabs) {
        const leftTab = s.tabs.find((t) => t.path === d.leftPath)
        const rightTab = s.tabs.find((t) => t.path === d.rightPath)
        if (leftTab) stillReferenced.add(leftTab.id)
        if (rightTab) stillReferenced.add(rightTab.id)
      }
      const nextTabs = s.tabs.filter((t) => stillReferenced.has(t.id))

      let nextActivePaneId = s.activePaneId
      if (!findLeafById(nextPaneRoot, nextActivePaneId)) {
        const leafIds = collectLeafIds(nextPaneRoot)
        nextActivePaneId = leafIds[0] ?? 'root'
      }

      return {
        tabs: nextTabs,
        diffTabs: nextDiffTabs,
        paneRoot: nextPaneRoot,
        activePaneId: nextActivePaneId,
        activeTabId: deriveActiveTabId(nextPaneRoot, nextActivePaneId),
      }
    })
  },

  swapDiffSides: (diffId) => {
    set((s) => ({
      diffTabs: s.diffTabs.map((d) =>
        d.id === diffId ? { ...d, leftPath: d.rightPath, rightPath: d.leftPath } : d,
      ),
    }))
  },

  replaceDiffFile: async (diffId, side, newPath) => {
    // Load file into the tabs pool (without adding to any pane)
    if (!get().tabs.find((t) => t.path === newPath)) {
      let content: string
      let name: string
      try {
        content = await window.api.readFile(newPath)
        name = await window.api.basename(newPath)
      } catch {
        const basename = newPath.split('/').pop() || newPath
        get().showToast(`Can't open "${basename}" — file no longer exists`, 'error')
        return
      }
      const tab: OpenFile = { id: newPath, path: newPath, name, content, savedContent: content }
      set((s) => ({ tabs: [...s.tabs, tab] }))
    }
    set((s) => ({
      diffTabs: s.diffTabs.map((d) => {
        if (d.id !== diffId) return d
        return side === 'left'
          ? { ...d, leftPath: newPath }
          : { ...d, rightPath: newPath }
      }),
    }))
  },
}))

let toastIdCounter = 0

/**
 * Apply an external change to an open tab. Called for every watcher `change`
 * event on a path we have open. Does three things:
 *
 * 1. Suppresses our own writes by content equality (if disk matches what we
 *    last saved, there's nothing to do — the watcher is echoing our write).
 * 2. Defers the reload if the user typed within `TYPING_DEFER_MS`; retries
 *    automatically via `scheduleReload` so the apply lands the moment the
 *    user pauses.
 * 3. Otherwise overwrites both `content` and `savedContent` in one go, which
 *    keeps the dirty indicator honest and lets CodeMirror's own undo stack
 *    recover the replaced buffer if the external write was surprising.
 */
const doReload = async (path: string): Promise<void> => {
  const tab = useWorkspace.getState().tabs.find((t) => t.path === path)
  if (!tab) return

  let disk: string
  try {
    disk = await window.api.readFile(path)
  } catch {
    // Read failed (permissions, transient, etc.) — nothing safe to do here;
    // a follow-up watcher event will retry.
    return
  }

  // Self-write suppression: if disk already matches what we last saved, this
  // is the echo of our own writeFile. No state change needed.
  if (disk === tab.savedContent && disk === tab.content) return

  // If the user typed very recently, don't yank the buffer out from under
  // them mid-keystroke. Schedule a retry for when typing has paused.
  const typedAt = lastTypedAt.get(path)
  if (typedAt !== undefined && Date.now() - typedAt < TYPING_DEFER_MS) {
    scheduleReload(path)
    return
  }

  // Re-read state because the async readFile may have been overtaken by a
  // user edit — we want the *current* tab id, not a stale closure.
  const current = useWorkspace.getState().tabs.find((t) => t.path === path)
  if (!current) return

  useWorkspace.setState((s) => ({
    tabs: s.tabs.map((t) => (t.id === current.id ? { ...t, content: disk, savedContent: disk } : t))
  }))
}

/** Debounce-retry a reload until the user has stopped typing. Replaces any
 *  previously-scheduled reload for the same path. */
const scheduleReload = (path: string): void => {
  const existing = pendingReloads.get(path)
  if (existing) clearTimeout(existing)
  const typedAt = lastTypedAt.get(path) ?? 0
  const wait = Math.max(50, TYPING_DEFER_MS - (Date.now() - typedAt))
  const timer = setTimeout(() => {
    pendingReloads.delete(path)
    void doReload(path)
  }, wait)
  pendingReloads.set(path, timer)
}

/**
 * Promote `path` to the top of the Recents list, trimming to the cap and
 * persisting the change. No-op when `path` is already at the top — that
 * guard keeps keystroke-driven bumps from thrashing settings on every edit.
 */
const bumpRecentFile = (path: string): void => {
  const prev = useWorkspace.getState().recentFiles
  const next = [path, ...prev.filter((p) => p !== path)].slice(0, MAX_RECENT_FILES)
  if (next[0] === prev[0] && next.length === prev.length) return
  useWorkspace.setState({ recentFiles: next })
  void persistSettings({ recentFiles: next })
}

/** Cancel any pending deferred reload for `path`. Called before we save
 *  or close a tab, so a stale watcher event doesn't fire into emptiness. */
const cancelPendingReload = (path: string): void => {
  const t = pendingReloads.get(path)
  if (t) {
    clearTimeout(t)
    pendingReloads.delete(path)
  }
}
