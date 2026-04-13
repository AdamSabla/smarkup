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
    content: `# Notes\n\n- First thought\n- Second thought\n- Third thought\n`,
    mtimeMs: baseTime - 1000 * 60 * 60
  }
]

let mockSettings: Settings = {
  draftsFolder: '/demo',
  additionalFolders: [],
  theme: 'system',
  sidebarVisible: true,
  editorMode: 'visual',
  openTabs: [],
  activeTabPath: null,
  recentFiles: [],
  autoSave: false,
  autoSaveDelayMs: 1500,
  showWordCount: false
}

const listEntries = (): FileEntry[] =>
  files
    .map<FileEntry>((f) => ({
      name: f.name,
      path: f.path,
      isDirectory: false,
      mtimeMs: f.mtimeMs
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

const mockApi: SmarkupApi = {
  openDirectory: async () => '/demo',

  readDirectory: async () => listEntries(),

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
    const file = files.find((f) => f.path === oldPath)
    if (!file) throw new Error(`File not found: ${oldPath}`)
    const parent = oldPath.slice(0, oldPath.lastIndexOf('/'))
    const newPath = `${parent}/${newName}`
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

  createDirectory: async (parent, name) => `${parent.replace(/\/$/, '')}/${name}`,

  listFoldersRecursive: async () => [],

  revealInFolder: async () => true,

  deletePath: async (path) => {
    const idx = files.findIndex((f) => f.path === path)
    if (idx >= 0) files.splice(idx, 1)
    return true
  },

  basename: async (path) => path.slice(path.lastIndexOf('/') + 1),

  dirname: async (path) => {
    const idx = path.lastIndexOf('/')
    return idx === 0 ? '/' : path.slice(0, idx)
  },

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
  checkForUpdates: async () => ({ kind: 'not-available' }) as UpdateStatus,
  getUpdateStatus: async () => ({ kind: 'idle' }) as UpdateStatus,
  openReleaseUrl: async (url) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  onUpdateStatus: () => () => undefined,

  // Window management: no-op in browser mode (single window only)
  getWindowId: () => 'default',
  getWindowInit: async () => null,
  openTabInNewWindow: async () => undefined
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
