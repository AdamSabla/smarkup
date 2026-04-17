import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type FileEntry = {
  name: string
  path: string
  isDirectory: boolean
  mtimeMs: number
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking'; userInitiated: boolean }
  | { kind: 'available'; version: string; releaseUrl: string; userInitiated: boolean }
  | {
      kind: 'downloading'
      version: string
      releaseUrl: string
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    }
  | { kind: 'downloaded'; version: string; releaseUrl: string }
  | { kind: 'not-available'; userInitiated: boolean; currentVersion: string; checkId: number }
  | {
      kind: 'error'
      message: string
      userInitiated: boolean
      releaseUrl: string | null
      checkId: number
    }

export type Theme = 'light' | 'dark' | 'system'

export type Settings = {
  draftsFolder: string | null
  additionalFolders: string[]
  theme: Theme
  sidebarVisible: boolean
  editorMode: 'visual' | 'raw'
  /**
   * Per-file editor mode overrides, keyed by absolute path. When present,
   * the file opens in the recorded mode; otherwise the global `editorMode`
   * is used.
   */
  fileEditorModes: Record<string, 'visual' | 'raw'>
  openTabs: string[]
  activeTabPath: string | null
  recentFiles: string[]
  autoSave: boolean
  autoSaveDelayMs: number
  showWordCount: boolean
  rawHeadingSizes: boolean
  rawWordWrap: boolean
  /** Whether the bottom Variables panel is shown. */
  variablesPanelVisible: boolean
  /**
   * Files (by absolute path) whose name is still being auto-derived from
   * their first non-empty line. Removed once the user explicitly renames.
   */
  autoNamedPaths: string[]
}

export type WatchEvent = {
  folder: string
  path: string
  type: 'add' | 'unlink' | 'change' | 'rename'
  /** For `rename` only — the previous path of the file (inode-correlated
   *  in the main-process watcher). Present so the renderer can migrate any
   *  open tab's id/path instead of closing-and-reopening. */
  fromPath?: string
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
  /** Prompt the user for any file on disk. Returns the chosen absolute path
   *  or null if they cancelled. Used by the sidebar's "Open file…" entry. */
  openFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  /** Show a native "Save as…" dialog. Returns the chosen absolute path or
   *  null if the user cancelled. Used by the OrphanBanner to rescue a tab
   *  whose file was deleted externally. */
  saveFileDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName),
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
  isDirectory: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:isDirectory', path),
  pathExists: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:pathExists', path),
  // Electron ≥ 32 no longer exposes `.path` on dropped File objects — you have
  // to resolve it through `webUtils.getPathForFile` in the preload.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

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
  /** Quit the app and run the already-downloaded installer. */
  quitAndInstallUpdate: (): Promise<void> => ipcRenderer.invoke('updater:quitAndInstall'),
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
  onToggleVariablesPanel: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('app:toggleVariablesPanel', handler)
    return () => {
      ipcRenderer.off('app:toggleVariablesPanel', handler)
    }
  },
  onOpenDiffPicker: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('app:openDiffPicker', handler)
    return () => {
      ipcRenderer.off('app:openDiffPicker', handler)
    }
  },
  /** Main sends a file path here when the OS asks us to open a file
   *  ("Open With…" in Finder, file double-click on Win/Linux, or the
   *  File → Open… menu item). The renderer routes it through
   *  `useWorkspace.openFile`. */
  onOpenFileFromDisk: (callback: (path: string) => void): (() => void) => {
    const handler = (_event: unknown, path: string): void => callback(path)
    ipcRenderer.on('app:openFileFromDisk', handler)
    return () => {
      ipcRenderer.off('app:openFileFromDisk', handler)
    }
  },

  // --- Window management ------------------------------------------------
  getWindowId: (): string =>
    new URLSearchParams(window.location.search).get('windowId') ?? 'default',
  getWindowInit: (windowId: string): Promise<WindowInit | null> =>
    ipcRenderer.invoke('window:getInit', windowId),
  openTabInNewWindow: (tab: TabTransferData, pos: { x: number; y: number }): Promise<void> =>
    ipcRenderer.invoke('window:openTabInNewWindow', tab, pos),

  // Main process asks the renderer to close this window (red X, Cmd+Q, etc.)
  // so the renderer can prompt about unsaved changes first.
  onCloseRequested: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('window:closeRequested', handler)
    return () => {
      ipcRenderer.off('window:closeRequested', handler)
    }
  },
  /** Tell main it's OK to actually close this window. */
  confirmClose: (): Promise<void> => ipcRenderer.invoke('window:confirmClose'),
  /** Tell main the user cancelled the unsaved-changes dialog, so a Cmd+Q
   *  sequence must not silently resume later. */
  cancelClose: (): Promise<void> => ipcRenderer.invoke('window:cancelClose')
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
