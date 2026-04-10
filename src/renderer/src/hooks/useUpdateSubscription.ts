import { useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'

export const useUpdateSubscription = (): void => {
  const setUpdateStatus = useWorkspace((s) => s.setUpdateStatus)

  useEffect(() => {
    // Pull the current status once on mount — the main process may have
    // already detected an update before the renderer subscribed.
    window.api.getUpdateStatus().then(setUpdateStatus)

    const unsubscribe = window.api.onUpdateStatus(setUpdateStatus)
    return unsubscribe
  }, [setUpdateStatus])
}
