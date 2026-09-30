import { useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'

/**
 * Subscribes to main-process file watch events and routes them through
 * the workspace store's `handleWatchEvent`. Unsubscribes on unmount.
 *
 * Also keeps the main process watching every open file that sits outside the
 * watched folders, so a tab always shows the file as it is on disk — an agent
 * or another editor rewriting it shows up the same way wherever it lives.
 */
export const useFileWatcher = (): void => {
  const handleWatchEvent = useWorkspace((s) => s.handleWatchEvent)

  useEffect(() => {
    const unsubscribe = window.api.onWatchEvent((payload) => {
      void handleWatchEvent(payload)
    })
    return unsubscribe
  }, [handleWatchEvent])

  // Joined into one string so the selector only changes when the set of
  // uncovered files does — not on every keystroke that rewrites `tabs`.
  const uncoveredFiles = useWorkspace((s) => {
    const folders = [s.draftsFolder, ...s.additionalFolders].filter((f): f is string => !!f)
    // Mirrors what the folder watcher reports (main/watcher.ts): `.md` files,
    // not inside a hidden directory. Anything else gets a watch of its own.
    const covered = (path: string): boolean =>
      /\.md$/i.test(path) &&
      folders.some(
        (folder) => path.startsWith(folder + '/') && !/(^|\/)\./.test(path.slice(folder.length + 1))
      )
    return Array.from(new Set(s.tabs.map((t) => t.path).filter((p) => !covered(p))))
      .sort()
      .join('\n')
  })

  useEffect(() => {
    void window.api.syncWatchedFiles(uncoveredFiles ? uncoveredFiles.split('\n') : [])
  }, [uncoveredFiles])
}
