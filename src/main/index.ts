import { app, shell, BrowserWindow, ipcMain, nativeTheme, dialog } from 'electron'
import { join, dirname, basename } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'

const isMac = process.platform === 'darwin'

const createWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 640,
    minHeight: 480,
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// --- File IPC handlers ---------------------------------------------------

type FileEntry = {
  name: string
  path: string
  isDirectory: boolean
}

const readDirectoryEntries = async (dirPath: string): Promise<FileEntry[]> => {
  const dirents = await fs.readdir(dirPath, { withFileTypes: true })
  return dirents
    .filter((d) => !d.name.startsWith('.'))
    .map((d) => ({
      name: d.name,
      path: join(dirPath, d.name),
      isDirectory: d.isDirectory()
    }))
    .sort((a, b) => {
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

  ipcMain.handle('fs:delete', async (_event, filePath: string) => {
    await fs.rm(filePath, { recursive: true, force: true })
    return true
  })

  ipcMain.handle('fs:basename', (_event, filePath: string) => basename(filePath))

  ipcMain.handle('fs:dirname', (_event, filePath: string) => dirname(filePath))
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
  // Don't attempt auto-download — surface an "update available" banner and
  // let the user click through to the GitHub Release to download manually.
  // This avoids needing code signing for the initial release flow.
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
  registerUpdater()
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
