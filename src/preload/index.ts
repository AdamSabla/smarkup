import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export type FileEntry = {
  name: string
  path: string
  isDirectory: boolean
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
  deletePath: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:delete', path),
  basename: (path: string): Promise<string> => ipcRenderer.invoke('fs:basename', path),
  dirname: (path: string): Promise<string> => ipcRenderer.invoke('fs:dirname', path)
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
