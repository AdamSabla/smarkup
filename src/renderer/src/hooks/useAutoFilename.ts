import { useEffect, useRef } from 'react'
import { useWorkspace } from '@/store/workspace'

/** How long to wait after the last keystroke before attempting a rename.
 *  Long enough to avoid a rename per character; short enough that the
 *  filename feels responsive while you're writing the title. */
const DEBOUNCE_MS = 600

/**
 * Watches the active tab's content and, if the tab is in `autoNamedPaths`,
 * triggers `autoRenameActiveTab()` after a debounce. The store action
 * silently no-ops if the derived name didn't change or would collide.
 *
 * Mounted once at the App root; the active-tab dependency means a tab
 * switch resets the timer (any in-flight rename for the previous tab
 * still completes — the action is path-bound, not active-tab-bound).
 */
export const useAutoFilename = (): void => {
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const tabs = useWorkspace((s) => s.tabs)
  const autoNamedPaths = useWorkspace((s) => s.autoNamedPaths)
  const autoRenameActiveTab = useWorkspace((s) => s.autoRenameActiveTab)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const content = activeTab?.content
  const isAutoNamed = activeTab ? autoNamedPaths.has(activeTab.path) : false

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isAutoNamed) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void autoRenameActiveTab()
    }, DEBOUNCE_MS)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isAutoNamed, content, autoRenameActiveTab])
}
