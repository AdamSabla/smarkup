/**
 * Watches a set of directories for markdown file changes and broadcasts
 * debounced `fs:watchEvent` messages to all renderer windows. The renderer
 * responds by refreshing the section that contains the changed path.
 */
import { BrowserWindow } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'

export type WatchEvent = {
  folder: string
  path: string
  type: 'add' | 'unlink' | 'change' | 'rename'
}

const watchers = new Map<string, FSWatcher>()
const pendingByFolder = new Map<string, Set<WatchEvent>>()
const flushTimers = new Map<string, NodeJS.Timeout>()

const flush = (folder: string): void => {
  const pending = pendingByFolder.get(folder)
  if (!pending || pending.size === 0) return
  const events = Array.from(pending)
  pending.clear()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('fs:watchEvent', { folder, events })
  }
}

const schedule = (folder: string, event: WatchEvent): void => {
  let set = pendingByFolder.get(folder)
  if (!set) {
    set = new Set()
    pendingByFolder.set(folder, set)
  }
  set.add(event)

  const existing = flushTimers.get(folder)
  if (existing) clearTimeout(existing)
  flushTimers.set(
    folder,
    setTimeout(() => {
      flushTimers.delete(folder)
      flush(folder)
    }, 150)
  )
}

export const startWatching = (folder: string): void => {
  if (watchers.has(folder)) return
  const watcher = chokidar.watch(folder, {
    depth: 0,
    ignoreInitial: true,
    ignored: (path) => /(^|[\\/])\../.test(path),
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 60 }
  })

  const isMarkdown = (p: string): boolean => /\.md$/i.test(p)

  watcher
    .on('add', (path) => {
      if (isMarkdown(path)) schedule(folder, { folder, path, type: 'add' })
    })
    .on('unlink', (path) => {
      if (isMarkdown(path)) schedule(folder, { folder, path, type: 'unlink' })
    })
    .on('change', (path) => {
      if (isMarkdown(path)) schedule(folder, { folder, path, type: 'change' })
    })

  watchers.set(folder, watcher)
}

export const stopWatching = (folder: string): void => {
  const watcher = watchers.get(folder)
  if (!watcher) return
  void watcher.close()
  watchers.delete(folder)
  pendingByFolder.delete(folder)
  const timer = flushTimers.get(folder)
  if (timer) {
    clearTimeout(timer)
    flushTimers.delete(folder)
  }
}

export const syncWatchedFolders = (folders: string[]): void => {
  const desired = new Set(folders.filter(Boolean))
  for (const existing of watchers.keys()) {
    if (!desired.has(existing)) stopWatching(existing)
  }
  for (const folder of desired) {
    if (!watchers.has(folder)) startWatching(folder)
  }
}

export const stopAllWatchers = (): void => {
  for (const folder of Array.from(watchers.keys())) stopWatching(folder)
}
