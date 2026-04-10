import { useEffect, useRef } from 'react'
import { useWorkspace } from '@/store/workspace'

/**
 * Persists the list of open tabs and the active tab across app restarts.
 * Debounced so rapid tab changes don't hammer the settings file.
 */
export const usePersistOpenTabs = (): void => {
  const hydrated = useWorkspace((s) => s.hydrated)
  const tabs = useWorkspace((s) => s.tabs)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const lastPersisted = useRef<string>('')

  useEffect(() => {
    if (!hydrated) return
    const openTabs = tabs.map((t) => t.path)
    const key = JSON.stringify({ openTabs, activeTabId })
    if (key === lastPersisted.current) return
    lastPersisted.current = key

    const id = setTimeout(() => {
      void window.api.saveSettings({ openTabs, activeTabPath: activeTabId })
    }, 250)

    return () => clearTimeout(id)
  }, [hydrated, tabs, activeTabId])
}
