/**
 * In-memory mock of `window.api` used when the renderer runs in a plain
 * browser (via `npm run dev:browser`). Lets you iterate on UI without
 * rebuilding the Electron shell. NOT used in production or in the real
 * Electron dev window — gated on the absence of the real preload bridge.
 */
// Type-only import: erased at build time so Vite never bundles the real
// preload file (which imports Electron and would crash in a browser).
import type { FileEntry, Settings, SmarkupApi, UpdateStatus } from '../../../preload'

type MockFile = { path: string; name: string; content: string; mtimeMs: number }

const baseTime = Date.now()
const files: MockFile[] = [
  {
    path: '/demo/welcome.md',
    name: 'welcome.md',
    content: `# Welcome to smarkup (browser preview)\n\nYou're running the renderer in a plain browser tab with a mocked file system.\n\n- Switch between **Visual** and **Raw** in the top right\n- Create a new file with the "+" button in the sidebar\n- Files live in memory only while this tab is open\n\n> To test real file I/O, run \`npm run dev\` to open the Electron shell instead.\n`,
    mtimeMs: baseTime
  },
  {
    path: '/demo/notes.md',
    name: 'notes.md',
    // Deliberately multi-level with a leading paragraph and a partial import —
    // this is the fixture for exercising the outline dialog in the browser.
    content: `Intro text that sits before any heading, so it can never belong to a section.\n\n# Builder prompt\n\nTop level overview.\n\n## Mid-session continuation\n\nYou are always mid-session.\n\n## Tools\n\nPick the right one.\n\n### update_resume\n\nAll resume-section mutations.\n\n### update_profile\n\nAll profile mutations. See {{> _shared/market-conventions}} for the rules.\n\n## Routing\n\nOne branch per turn.\n\n### Branch 3 — auto-draft\n\nDraft every section in one pass.\n\n### Branch 4 — clarification loop\n\nAsk the next gap question.\n\n## Polish posture\n\nReword, don't invent.\n`,
    mtimeMs: baseTime - 1000 * 60 * 60
  },
  {
    // The target of notes.md's `{{> _shared/market-conventions}}` import —
    // here so the preview can exercise click-to-open on a partial.
    path: '/demo/_shared/market-conventions.md',
    name: 'market-conventions.md',
    content: `# Market conventions\n\nShared rules pulled into the prompts that import this file.\n`,
    mtimeMs: baseTime - 1000 * 60 * 30
  },
  {
    path: '/demo/archive/older-notes.md',
    name: 'older-notes.md',
    content: `# Older notes\n\nKept around so the preview has something inside a folder.\n`,
    mtimeMs: baseTime - 1000 * 60 * 60 * 24
  }
]

/** Directories, tracked as plain paths — enough for the sidebar's folder rows,
 *  their context menus, and creating/renaming/deleting them. */
const dirs: string[] = ['/demo/_shared', '/demo/archive']

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/'

/** Everything at or below `path` — what a recursive delete or rename has to
 *  drag along with it. */
const isUnder = (path: string, root: string): boolean => path.startsWith(`${root}/`)

let mockSettings: Settings = {
  draftsFolder: '/demo',
  additionalFolders: [],
  theme: 'system',
  sidebarVisible: true,
  editorMode: 'visual',
  fileEditorModes: {},
  openTabs: [],
  activeTabPath: null,
  recentFiles: [],
  autoSave: false,
  autoSaveDelayMs: 1500,
  showWordCount: false,
  rawHeadingSizes: false,
  rawWordWrap: true,
  visualSyntaxHighlight: false,
  visualHeadingMarkers: false,
  variablesPanelVisible: false,
  outlinePanelVisible: false,
  outlinePanelWidth: 260,
  outlinePanelSide: 'right',
  showRecents: false,
  showTabParentFolder: false,
  autoNamedPaths: [],
  collapsedSidebarSections: [],
  expandedSidebarSubfolders: []
}

const listEntries = (dir: string): FileEntry[] => {
  const folders = dirs
    .filter((d) => parentOf(d) === dir)
    .map<FileEntry>((d) => ({
      name: d.slice(d.lastIndexOf('/') + 1),
      path: d,
      isDirectory: true,
      mtimeMs: baseTime
    }))
  const children = files
    .filter((f) => parentOf(f.path) === dir)
    .map<FileEntry>((f) => ({
      name: f.name,
      path: f.path,
      isDirectory: false,
      mtimeMs: f.mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  return [...folders, ...children]
}

const mockApi: SmarkupApi = {
  openDirectory: async () => '/demo',

  // No native file dialog in browser preview — the in-memory FS doesn't need
  // one and `window.showOpenFilePicker` isn't worth the polyfill effort.
  openFile: async () => null,
  saveFileDialog: async () => null,

  readDirectory: async (path) => listEntries(path),

  readFile: async (path) => {
    const file = files.find((f) => f.path === path)
    if (!file) throw new Error(`File not found: ${path}`)
    return file.content
  },

  writeFile: async (path, contents) => {
    const file = files.find((f) => f.path === path)
    if (file) {
      file.content = contents
      file.mtimeMs = Date.now()
    }
    return true
  },

  createFile: async (parentDir, name) => {
    const safeName = name.endsWith('.md') ? name : `${name}.md`
    const path = `${parentDir.replace(/\/$/, '')}/${safeName}`
    files.push({ path, name: safeName, content: '', mtimeMs: Date.now() })
    return path
  },

  rename: async (oldPath, newName) => {
    const newPath = `${parentOf(oldPath)}/${newName}`
    const dirIndex = dirs.indexOf(oldPath)
    if (dirIndex >= 0) {
      dirs[dirIndex] = newPath
      for (let i = 0; i < dirs.length; i++) {
        if (isUnder(dirs[i], oldPath)) dirs[i] = newPath + dirs[i].slice(oldPath.length)
      }
      for (const f of files) {
        if (isUnder(f.path, oldPath)) f.path = newPath + f.path.slice(oldPath.length)
      }
      return newPath
    }
    const file = files.find((f) => f.path === oldPath)
    if (!file) throw new Error(`File not found: ${oldPath}`)
    file.path = newPath
    file.name = newName
    return newPath
  },

  move: async (oldPath, destDir) => {
    const file = files.find((f) => f.path === oldPath)
    if (!file) throw new Error(`File not found: ${oldPath}`)
    const newPath = `${destDir.replace(/\/$/, '')}/${file.name}`
    file.path = newPath
    return newPath
  },

  createDirectory: async (parent, name) => {
    const path = `${parent.replace(/\/$/, '')}/${name}`
    if (!dirs.includes(path)) dirs.push(path)
    return path
  },

  listFoldersRecursive: async (root) => dirs.filter((d) => isUnder(d, root)),

  revealInFolder: async () => true,

  deletePath: async (path) => {
    // Folders go recursively, matching the real `fs.rm` the menu warns about.
    for (let i = dirs.length - 1; i >= 0; i--) {
      if (dirs[i] === path || isUnder(dirs[i], path)) dirs.splice(i, 1)
    }
    for (let i = files.length - 1; i >= 0; i--) {
      if (files[i].path === path || isUnder(files[i].path, path)) files.splice(i, 1)
    }
    return true
  },

  basename: async (path) => path.slice(path.lastIndexOf('/') + 1),

  dirname: async (path) => {
    const idx = path.lastIndexOf('/')
    return idx === 0 ? '/' : path.slice(0, idx)
  },

  isDirectory: async (path) => dirs.includes(path),
  pathExists: async (path) => dirs.includes(path) || files.some((f) => f.path === path),
  // Native drag-drop of OS folders — nothing to resolve in browser mode.
  getPathForFile: () => '',

  // Settings: stored in module scope for the lifetime of the browser tab
  loadSettings: async () => mockSettings,
  saveSettings: async (patch) => {
    mockSettings = { ...mockSettings, ...patch }
    return mockSettings
  },

  // Watcher: no-op in browser mode
  syncWatchedFolders: async () => true,
  onWatchEvent: () => () => undefined,

  // Updater: no-op in browser mode
  checkForUpdates: async () =>
    ({
      kind: 'not-available',
      userInitiated: true,
      currentVersion: '0.0.0-browser'
    }) as UpdateStatus,
  getUpdateStatus: async () => ({ kind: 'idle' }) as UpdateStatus,
  openReleaseUrl: async (url) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  quitAndInstallUpdate: async () => undefined,
  onUpdateStatus: () => () => undefined,

  // App menu events: no-op in browser mode
  onShowShortcuts: () => () => undefined,
  onToggleVariablesPanel: () => () => undefined,
  onToggleEditorMode: () => () => undefined,
  onOpenDiffPicker: () => () => undefined,
  onNewDraft: () => () => undefined,
  onSave: () => () => undefined,
  onSaveAs: () => () => undefined,
  onDuplicateFile: () => () => undefined,
  onRenameFile: () => () => undefined,
  onReopenClosedTab: () => () => undefined,
  onOpenSettings: () => () => undefined,
  onToggleSidebar: () => () => undefined,
  onOpenFindBar: () => () => undefined,
  onOpenFileFromDisk: () => () => undefined,

  // Window management: no-op in browser mode (single window only)
  getWindowId: () => 'default',
  getWindowInit: async () => null,
  openTabInNewWindow: async () => undefined,
  onCloseRequested: () => () => undefined,
  confirmClose: async () => undefined,
  cancelClose: async () => undefined
}

export const installBrowserMockApi = (): void => {
  if (typeof window === 'undefined') return
  if ((window as unknown as { api?: unknown }).api) return
  ;(window as unknown as { api: SmarkupApi }).api = mockApi
  console.info(
    '[smarkup] Browser preview mode — using in-memory mock of window.api. ' +
      'Run `npm run dev` for the real Electron shell.'
  )
  document.documentElement.dataset.smarkupBrowserPreview = 'true'
}
