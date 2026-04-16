/**
 * Watches a set of directories for markdown file changes and broadcasts
 * debounced `fs:watchEvent` messages to all renderer windows. The renderer
 * responds by refreshing the section that contains the changed path.
 *
 * Supports ref-counted watching across multiple windows — a folder is only
 * unwatched when no window needs it anymore.
 *
 * An atomic rename (mv, Finder drag, `git mv`, etc.) surfaces as an `unlink`
 * immediately followed by an `add`. We correlate the two by inode within a
 * short window so the renderer can migrate any open tab's path in place
 * instead of closing-and-reopening. On APFS/ext4 renames preserve the
 * inode, so this is reliable on the platforms we ship to. Cases that don't
 * preserve inode (cross-device moves, some network FS) fall through as a
 * plain unlink+add, which the renderer handles separately.
 */
import { BrowserWindow } from 'electron'
import { promises as fs, type Stats } from 'fs'
import chokidar, { type FSWatcher } from 'chokidar'

export type WatchEvent = {
  folder: string
  path: string
  type: 'add' | 'unlink' | 'change' | 'rename'
  /** Set on `rename`; absent otherwise. */
  fromPath?: string
}

const watchers = new Map<string, FSWatcher>()
const pendingByFolder = new Map<string, Set<WatchEvent>>()
const flushTimers = new Map<string, NodeJS.Timeout>()

/** Per-window watch registry for ref-counting */
const windowWatches = new Map<string, Set<string>>()

/**
 * Inode bookkeeping for rename correlation, scoped per folder so a flurry
 * of unrelated unlinks in one folder can't accidentally correlate with an
 * add in another.
 */
type FolderInodeState = {
  /** Last-known inode for each live path in this folder. Populated on add
   *  and change events. Used to stamp an unlink with its prior inode so we
   *  can look it up when the matching add arrives. */
  pathToInode: Map<string, number>
  /** Unlinks waiting for a matching add. Key is inode. Value carries the
   *  removed path and a timer that finalizes the event as a plain unlink
   *  once the correlation window elapses. */
  pendingUnlinks: Map<number, { path: string; timer: NodeJS.Timeout }>
}
const folderState = new Map<string, FolderInodeState>()

/** How long to hold an unlink open waiting for a matching add. Atomic
 *  renames on local FSes land well within this window; network FSes that
 *  don't preserve inodes will simply exceed it and finalize as unlink. */
const RENAME_CORRELATION_MS = 200

const ensureFolderState = (folder: string): FolderInodeState => {
  let s = folderState.get(folder)
  if (!s) {
    s = { pathToInode: new Map(), pendingUnlinks: new Map() }
    folderState.set(folder, s)
  }
  return s
}

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

/** Read inode from chokidar's optional stats, falling back to an explicit
 *  fs.stat() if stats weren't provided (chokidar skips the stat when the
 *  listener is registered without `alwaysStat: true` OR for synthetic
 *  events — defensive double-check). */
const resolveInode = async (path: string, stats: Stats | undefined): Promise<number | null> => {
  if (stats && typeof stats.ino === 'number') return stats.ino
  try {
    const s = await fs.stat(path)
    return s.ino
  } catch {
    return null
  }
}

const startWatching = (folder: string): void => {
  if (watchers.has(folder)) return
  const watcher = chokidar.watch(folder, {
    ignoreInitial: true,
    ignored: (path) => /(^|[\\/])\../.test(path),
    alwaysStat: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 60 }
  })

  const isMarkdown = (p: string): boolean => /\.md$/i.test(p)
  const state = ensureFolderState(folder)

  watcher
    .on('add', (path, stats) => {
      if (!isMarkdown(path)) return
      void (async () => {
        const ino = await resolveInode(path, stats)
        if (ino !== null) {
          state.pathToInode.set(path, ino)
          // Did this add match a just-unlinked file at the same inode?
          // That's our atomic-rename signal. Cancel the pending unlink and
          // emit a single `rename` instead.
          const pending = state.pendingUnlinks.get(ino)
          if (pending) {
            clearTimeout(pending.timer)
            state.pendingUnlinks.delete(ino)
            if (pending.path !== path) {
              schedule(folder, { folder, path, type: 'rename', fromPath: pending.path })
              return
            }
            // Same path, same inode — odd, but treat as a plain add (change).
          }
        }
        schedule(folder, { folder, path, type: 'add' })
      })()
    })
    .on('unlink', (path) => {
      if (!isMarkdown(path)) return
      const ino = state.pathToInode.get(path)
      state.pathToInode.delete(path)
      if (ino !== undefined) {
        // Defer the unlink by the correlation window. If a matching add
        // arrives, the add handler cancels this timer and emits a rename.
        const timer = setTimeout(() => {
          state.pendingUnlinks.delete(ino)
          schedule(folder, { folder, path, type: 'unlink' })
        }, RENAME_CORRELATION_MS)
        state.pendingUnlinks.set(ino, { path, timer })
      } else {
        // No inode on record — can't correlate. Fire immediately.
        schedule(folder, { folder, path, type: 'unlink' })
      }
    })
    .on('change', (path, stats) => {
      if (!isMarkdown(path)) return
      // Keep the inode cache fresh so a later unlink can look up.
      void (async () => {
        const ino = await resolveInode(path, stats)
        if (ino !== null) state.pathToInode.set(path, ino)
      })()
      schedule(folder, { folder, path, type: 'change' })
    })
    .on('addDir', (path) => {
      schedule(folder, { folder, path, type: 'add' })
    })
    .on('unlinkDir', (path) => {
      schedule(folder, { folder, path, type: 'unlink' })
    })

  watchers.set(folder, watcher)
}

const stopWatching = (folder: string): void => {
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
  const state = folderState.get(folder)
  if (state) {
    for (const { timer: t } of state.pendingUnlinks.values()) clearTimeout(t)
    folderState.delete(folder)
  }
}

/**
 * Sync watched folders for a specific window. The watcher computes the union
 * of all windows' desired folders and starts/stops chokidar watchers accordingly.
 */
export const syncWatchedFolders = (folders: string[], windowId: string = 'default'): void => {
  // Update this window's desired set
  const desired = new Set(folders.filter(Boolean))
  if (desired.size === 0) {
    windowWatches.delete(windowId)
  } else {
    windowWatches.set(windowId, desired)
  }

  // Compute the union of all windows' desired folders
  const union = new Set<string>()
  for (const set of windowWatches.values()) {
    for (const f of set) union.add(f)
  }

  // Start/stop watchers based on the union
  for (const existing of watchers.keys()) {
    if (!union.has(existing)) stopWatching(existing)
  }
  for (const folder of union) {
    if (!watchers.has(folder)) startWatching(folder)
  }
}

export const stopAllWatchers = (): void => {
  for (const folder of Array.from(watchers.keys())) stopWatching(folder)
  windowWatches.clear()
}
