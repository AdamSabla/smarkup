import { useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')
const mod = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey)

export const useShortcuts = (): void => {
  const {
    createFileInRoot,
    saveActive,
    closeTab,
    activeTabId,
    toggleSidebar,
    setEditorMode,
    editorMode,
    tabs,
    setActiveTab
  } = useWorkspace()

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!mod(e)) return

      // New file: cmd/ctrl+n
      if (e.key.toLowerCase() === 'n' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        void createFileInRoot()
        return
      }

      // Save: cmd/ctrl+s
      if (e.key.toLowerCase() === 's' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        void saveActive()
        return
      }

      // Close tab: cmd/ctrl+w
      if (e.key.toLowerCase() === 'w' && !e.shiftKey && !e.altKey) {
        if (activeTabId) {
          e.preventDefault()
          closeTab(activeTabId)
        }
        return
      }

      // Toggle sidebar: cmd/ctrl+.
      if (e.key === '.' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        toggleSidebar()
        return
      }

      // Toggle editor mode: cmd/ctrl+/
      if (e.key === '/' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        setEditorMode(editorMode === 'visual' ? 'raw' : 'visual')
        return
      }

      // Next/prev tab: ctrl+tab / ctrl+shift+tab
      if (e.key === 'Tab' && e.ctrlKey) {
        e.preventDefault()
        if (tabs.length === 0) return
        const idx = tabs.findIndex((t) => t.id === activeTabId)
        const dir = e.shiftKey ? -1 : 1
        const next = tabs[(idx + dir + tabs.length) % tabs.length]
        setActiveTab(next.id)
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    createFileInRoot,
    saveActive,
    closeTab,
    activeTabId,
    toggleSidebar,
    setEditorMode,
    editorMode,
    tabs,
    setActiveTab
  ])
}
