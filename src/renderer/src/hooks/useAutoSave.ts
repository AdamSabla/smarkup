import { useEffect, useRef } from 'react'
import { useWorkspace } from '@/store/workspace'

/**
 * When auto-save is enabled, debounces `saveActive()` on content changes
 * to the active tab. Skips if the tab is already clean. The timer resets
 * on every keystroke so only a pause in typing triggers a write.
 */
export const useAutoSave = (): void => {
  const autoSave = useWorkspace((s) => s.autoSave)
  const autoSaveDelayMs = useWorkspace((s) => s.autoSaveDelayMs)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const tabs = useWorkspace((s) => s.tabs)
  const saveActive = useWorkspace((s) => s.saveActive)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const content = activeTab?.content
  const savedContent = activeTab?.savedContent
  const dirty = activeTab && content !== savedContent

  useEffect(() => {
    if (!autoSave || !dirty) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void saveActive()
    }, autoSaveDelayMs)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [autoSave, autoSaveDelayMs, dirty, content, saveActive])
}
