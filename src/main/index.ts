import { app, shell, BrowserWindow, ipcMain, Menu, nativeTheme, dialog } from 'electron'
import { join, dirname, basename } from 'path'
import { promises as fs, type Dirent } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { loadSettings, saveSettings, type Settings } from './settings'
import { syncWatchedFolders, stopAllWatchers } from './watcher'
import icon from '../../resources/icon.png?asset'

const isMac = process.platform === 'darwin'

// --- Window manager ---------------------------------------------------------

type TabTransferData = {
  path: string
  content: string
  savedContent: string
}

type WindowInit = {
  tabs?: TabTransferData[]
  activeTabPath?: string | null
}

let windowIdCounter = 0
const windowInitStore = new Map<string, WindowInit>()
const windowIdMap = new Map<BrowserWindow, string>()
/** Windows whose renderer has explicitly approved the pending close. */
const approvedToClose = new WeakSet<BrowserWindow>()

const createWindow = (init?: WindowInit): BrowserWindow => {
  const windowId = String(++windowIdCounter)

  if (init) {
    windowInitStore.set(windowId, init)
  }

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: !isMac
      ? {
          color: '#00000000',
          symbolColor: '#888888',
          height: 36
        }
      : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'followWindow' : undefined,
    backgroundColor: isMac ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#171717' : '#ffffff',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  windowIdMap.set(mainWindow, windowId)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Intercept close so the renderer can prompt about unsaved changes first.
  // The renderer replies via `window:closeApproved` (which sets the flag and
  // re-closes) or simply ignores the request (cancel = do nothing).
  mainWindow.on('close', (event) => {
    if (approvedToClose.has(mainWindow)) return
    if (mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    mainWindow.webContents.send('window:closeRequested')
  })

  mainWindow.on('closed', () => {
    windowIdMap.delete(mainWindow)
    windowInitStore.delete(windowId)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Pass windowId as query param so renderer knows its identity synchronously
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('windowId', windowId)
    mainWindow.loadURL(url.toString())
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { windowId }
    })
  }

  return mainWindow
}

// --- File IPC handlers ---------------------------------------------------

type FileEntry = {
  name: string
  path: string
  isDirectory: boolean
  mtimeMs: number
}

const readDirectoryEntries = async (dirPath: string): Promise<FileEntry[]> => {
  const dirents = await fs.readdir(dirPath, { withFileTypes: true })
  const entries = await Promise.all(
    dirents
      .filter((d) => !d.name.startsWith('.'))
      .map(async (d) => {
        const fullPath = join(dirPath, d.name)
        let mtimeMs = 0
        try {
          const stat = await fs.stat(fullPath)
          mtimeMs = stat.mtimeMs
        } catch {
          // File may have been removed between readdir and stat
        }
        return {
          name: d.name,
          path: fullPath,
          isDirectory: d.isDirectory(),
          mtimeMs
        }
      })
  )
  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

const registerFileHandlers = (): void => {
  ipcMain.handle('dialog:openDirectory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('fs:readDirectory', async (_event, dirPath: string) => {
    return readDirectoryEntries(dirPath)
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    return fs.readFile(filePath, 'utf-8')
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, contents: string) => {
    await fs.writeFile(filePath, contents, 'utf-8')
    return true
  })

  ipcMain.handle(
    'fs:createFile',
    async (_event, parentDir: string, name: string): Promise<string> => {
      const safeName = name.endsWith('.md') ? name : `${name}.md`
      const fullPath = join(parentDir, safeName)
      await fs.writeFile(fullPath, '', { flag: 'wx' })
      return fullPath
    }
  )

  ipcMain.handle('fs:rename', async (_event, oldPath: string, newName: string) => {
    const newPath = join(dirname(oldPath), newName)
    await fs.rename(oldPath, newPath)
    return newPath
  })

  ipcMain.handle('fs:move', async (_event, oldPath: string, destDir: string) => {
    const name = basename(oldPath)
    const newPath = join(destDir, name)
    await fs.rename(oldPath, newPath)
    return newPath
  })

  ipcMain.handle('fs:createDirectory', async (_event, parent: string, name: string) => {
    const newDir = join(parent, name)
    await fs.mkdir(newDir, { recursive: false })
    return newDir
  })

  ipcMain.handle('fs:listFoldersRecursive', async (_event, root: string) => {
    const results: string[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6) return
      let dirents: Dirent[] = []
      try {
        dirents = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const d of dirents) {
        if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'node_modules') continue
        const full = join(dir, d.name)
        results.push(full)
        await walk(full, depth + 1)
      }
    }
    await walk(root, 0)
    return results
  })

  ipcMain.handle('fs:revealInFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
    return true
  })

  ipcMain.handle('fs:delete', async (_event, filePath: string) => {
    await fs.rm(filePath, { recursive: true, force: true })
    return true
  })

  ipcMain.handle('fs:basename', (_event, filePath: string) => basename(filePath))

  ipcMain.handle('fs:dirname', (_event, filePath: string) => dirname(filePath))

  // Used by the drag-and-drop folder dropzone to filter out non-directories
  // before we try to register them as workspaces.
  ipcMain.handle('fs:isDirectory', async (_event, p: string) => {
    try {
      const st = await fs.stat(p)
      return st.isDirectory()
    } catch {
      return false
    }
  })

  // Used by the auto-name-from-first-line feature to skip rename attempts
  // that would collide with an existing file.
  ipcMain.handle('fs:pathExists', async (_event, p: string) => {
    try {
      await fs.access(p)
      return true
    } catch {
      return false
    }
  })
}

// --- Settings IPC --------------------------------------------------------

const registerSettingsHandlers = (): void => {
  ipcMain.handle('settings:load', () => loadSettings())
  ipcMain.handle('settings:save', (_event, patch: Partial<Settings>) => saveSettings(patch))
}

// --- File watcher IPC ----------------------------------------------------

const registerWatcherHandlers = (): void => {
  ipcMain.handle('fs:syncWatchedFolders', (event, folders: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const windowId = win ? windowIdMap.get(win) ?? 'unknown' : 'unknown'
    syncWatchedFolders(folders, windowId)
    return true
  })
}

// --- Window management IPC -----------------------------------------------

const registerWindowHandlers = (): void => {
  // Renderer calls this on startup to get its init data (tabs to open, etc.)
  // We keep the entry around until the window closes (see the `closed`
  // handler in createWindow) rather than deleting on first read — React
  // StrictMode in dev double-invokes `useEffect`, so hydrate fires twice;
  // the second call needs to see the same init data or it would fall back
  // to restoring the parent window's full tab list from settings. A plain
  // renderer reload (Cmd+R) benefits from this too.
  ipcMain.handle('window:getInit', (_event, windowId: string) => {
    return windowInitStore.get(windowId) ?? null
  })

  // Renderer approves the pending close after the user picked
  // Save / Don't Save in the unsaved-changes dialog.
  ipcMain.handle('window:confirmClose', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    approvedToClose.add(win)
    win.close()
  })

  // Renderer calls this when a tab is dragged out or "Open in New Window" is selected
  ipcMain.handle(
    'window:openTabInNewWindow',
    (
      _event,
      tabData: TabTransferData,
      screenPos: { x: number; y: number }
    ) => {
      const win = createWindow({
        tabs: [tabData],
        activeTabPath: tabData.path
      })
      win.setBounds({
        x: Math.round(screenPos.x),
        y: Math.round(screenPos.y),
        width: 1000,
        height: 700
      })
    }
  )
}

// --- Auto-updater --------------------------------------------------------

type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string; releaseUrl: string }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string }

let latestUpdateStatus: UpdateStatus = { kind: 'idle' }

const broadcastUpdateStatus = (status: UpdateStatus): void => {
  latestUpdateStatus = status
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:status', status)
  }
}

const registerUpdater = (): void => {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    broadcastUpdateStatus({ kind: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    const releaseUrl = `https://github.com/AdamSabla/smarkup/releases/tag/v${info.version}`
    broadcastUpdateStatus({
      kind: 'available',
      version: info.version,
      releaseUrl
    })
  })

  autoUpdater.on('update-not-available', () => {
    broadcastUpdateStatus({ kind: 'not-available' })
  })

  autoUpdater.on('error', (err) => {
    broadcastUpdateStatus({ kind: 'error', message: err.message })
  })

  ipcMain.handle('updater:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      broadcastUpdateStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
    return latestUpdateStatus
  })

  ipcMain.handle('updater:getStatus', () => latestUpdateStatus)

  ipcMain.handle('updater:openRelease', async (_event, url: string) => {
    await shell.openExternal(url)
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.smarkup.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerFileHandlers()
  registerSettingsHandlers()
  registerWatcherHandlers()
  registerWindowHandlers()
  registerUpdater()

  // --- Native macOS menu ---------------------------------------------------
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Check for Updates…',
                click: (): void => {
                  autoUpdater.checkForUpdates().catch((err) => {
                    broadcastUpdateStatus({
                      kind: 'error',
                      message: err instanceof Error ? err.message : String(err)
                    })
                  })
                }
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' as const } : { role: 'quit' as const }]
    },
    { label: 'Edit', submenu: [
      { role: 'undo' as const },
      { role: 'redo' as const },
      { type: 'separator' as const },
      { role: 'cut' as const },
      { role: 'copy' as const },
      { role: 'paste' as const },
      { role: 'selectAll' as const }
    ]},
    {
      label: 'View',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+Shift+/',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow()
            if (win) win.webContents.send('app:showShortcuts')
          }
        },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
        ...(is.dev ? [
          { type: 'separator' as const },
          { role: 'reload' as const },
          { role: 'forceReload' as const },
          { role: 'toggleDevTools' as const }
        ] : [])
      ]
    },
    { label: 'Window', submenu: [
      { role: 'minimize' as const },
      { role: 'zoom' as const },
      ...(isMac ? [
        { type: 'separator' as const },
        { role: 'front' as const }
      ] : [
        { role: 'close' as const }
      ])
    ]},
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  createWindow()

  // Silent background check a few seconds after startup. Skips in dev.
  if (!is.dev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        broadcastUpdateStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
    }, 5000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAllWatchers()
})
