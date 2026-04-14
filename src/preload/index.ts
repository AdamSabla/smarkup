import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type FileEntry = {
  name: string
  path: string
  isDirectory: boolean
  mtimeMs: number
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; releaseUrl: string }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string }

export type Theme = 'light' | 'dark' | 'system'

export type Settings = {
  draftsFolder: string | null
  additionalFolders: string[]
  theme: Theme
  sidebarVisible: boolean
  editorMode: 'visual' | 'raw'
  openTabs: string[]
  activeTabPath: string | null
  recentFiles: string[]
  autoSave: boolean
  autoSaveDelayMs: number
  showWordCount: boolean
  rawHeadingSizes: boolean
}

export type WatchEvent = {
  folder: string
  path: string
  type: 'add' | 'unlink' | 'change' | 'rename'
}

export type WatchPayload = {
  folder: string
  events: WatchEvent[]
}

export type TabTransferData = {
  path: string
  content: string
  savedContent: string
}

export type WindowInit = {
  tabs?: TabTransferData[]
  activeTabPath?: string | null
}

const api = {
  openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  readDirectory: (path: string): Promise<FileEntry[]> =>
    ipcRenderer.invoke('fs:readDirectory', path),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, contents: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:writeFile', path, contents),
  createFile: (parentDir: string, name: string): Promise<string> =>
    ipcRenderer.invoke('fs:createFile', parentDir, name),
  rename: (oldPath: string, newName: string): Promise<string> =>
    ipcRenderer.invoke('fs:rename', oldPath, newName),
  move: (oldPath: string, destDir: string): Promise<string> =>
    ipcRenderer.invoke('fs:move', oldPath, destDir),
  createDirectory: (parent: string, name: string): Promise<string> =>
    ipcRenderer.invoke('fs:createDirectory', parent, name),
  listFoldersRecursive: (root: string): Promise<string[]> =>
    ipcRenderer.invoke('fs:listFoldersRecursive', root),
  revealInFolder: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:revealInFolder', filePath),
  deletePath: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:delete', path),
  basename: (path: string): Promise<string> => ipcRenderer.invoke('fs:basename', path),
  dirname: (path: string): Promise<string> => ipcRenderer.invoke('fs:dirname', path),

  // --- Settings ---------------------------------------------------------
  loadSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:load'),
  saveSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke('settings:save', patch),

  // --- Watcher ----------------------------------------------------------
  syncWatchedFolders: (folders: string[]): Promise<boolean> =>
    ipcRenderer.invoke('fs:syncWatchedFolders', folders),
  onWatchEvent: (callback: (payload: WatchPayload) => void): (() => void) => {
    const handler = (_event: unknown, payload: WatchPayload): void => callback(payload)
    ipcRenderer.on('fs:watchEvent', handler)
    return () => {
      ipcRenderer.off('fs:watchEvent', handler)
    }
  },

  // --- Updater ----------------------------------------------------------
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke('updater:check'),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke('updater:getStatus'),
  openReleaseUrl: (url: string): Promise<void> => ipcRenderer.invoke('updater:openRelease', url),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_event: unknown, status: UpdateStatus): void => callback(status)
    ipcRenderer.on('updater:status', handler)
    return () => {
      ipcRenderer.off('updater:status', handler)
    }
  },

  // --- App menu events ---------------------------------------------------
  onShowShortcuts: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('app:showShortcuts', handler)
    return () => {
      ipcRenderer.off('app:showShortcuts', handler)
    }
  },

  // --- Window management ------------------------------------------------
  getWindowId: (): string =>
    new URLSearchParams(window.location.search).get('windowId') ?? 'default',
  getWindowInit: (windowId: string): Promise<WindowInit | null> =>
    ipcRenderer.invoke('window:getInit', windowId),
  openTabInNewWindow: (
    tab: TabTransferData,
    pos: { x: number; y: number }
  ): Promise<void> => ipcRenderer.invoke('window:openTabInNewWindow', tab, pos)
}

export type SmarkupApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
