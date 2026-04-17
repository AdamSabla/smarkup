import { useEffect, useRef } from 'react'
import { useWorkspace, type PaneNode } from '@/store/workspace'

/** Collect all unique tab paths from the pane tree */
const collectTabPaths = (
  node: PaneNode,
  tabs: { id: string; path: string }[]
): string[] => {
  if (node.type === 'leaf') {
    return node.tabIds
      .map((id) => tabs.find((t) => t.id === id)?.path)
      .filter((p): p is string => p != null)
  }
  return [
    ...collectTabPaths(node.children[0], tabs),
    ...collectTabPaths(node.children[1], tabs)
  ]
}

/**
 * Persists the list of open tabs and the active tab across app restarts.
 * Debounced so rapid tab changes don't hammer the settings file.
 *
 * Only the first (default) window persists its tab state. Secondary windows
 * spawned via "Open in New Window" are ephemeral and don't save their tabs.
 */
export const usePersistOpenTabs = (): void => {
  const hydrated = useWorkspace((s) => s.hydrated)
  const tabs = useWorkspace((s) => s.tabs)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const paneRoot = useWorkspace((s) => s.paneRoot)
  const lastPersisted = useRef<string>('')
  const isDefaultWindow = useRef(window.api.getWindowId() === '1')

  useEffect(() => {
    if (!hydrated || !isDefaultWindow.current) return
    // Collect all unique open tab paths across all panes
    const seen = new Set<string>()
    const openTabs: string[] = []
    const allPaths = collectTabPaths(paneRoot, tabs)
    for (const p of allPaths) {
      if (!seen.has(p)) {
        seen.add(p)
        openTabs.push(p)
      }
    }
    const key = JSON.stringify({ openTabs, activeTabId })
    if (key === lastPersisted.current) return
    lastPersisted.current = key

    const id = setTimeout(() => {
      void window.api.saveSettings({ openTabs, activeTabPath: activeTabId })
    }, 250)

    return () => clearTimeout(id)
  }, [hydrated, tabs, activeTabId, paneRoot])
}
