import { useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'

/**
 * Subscribes to main-process file watch events and routes them through
 * the workspace store's `handleWatchEvent`. Unsubscribes on unmount.
 */
export const useFileWatcher = (): void => {
  const handleWatchEvent = useWorkspace((s) => s.handleWatchEvent)

  useEffect(() => {
    const unsubscribe = window.api.onWatchEvent((payload) => {
      void handleWatchEvent(payload)
    })
    return unsubscribe
  }, [handleWatchEvent])
}
