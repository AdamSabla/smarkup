import { useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')
const mod = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey)

export const useShortcuts = (): void => {
  const {
    createDraft,
    saveActive,
    closeTab,
    activeTabId,
    toggleSidebar,
    setEditorMode,
    editorMode,
    tabs,
    setActiveTab,
    openSettings,
    openCommandPalette
  } = useWorkspace()

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!mod(e)) return

      const key = e.key.toLowerCase()

      // New draft: cmd/ctrl+n  OR  cmd/ctrl+t
      if ((key === 'n' || key === 't') && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        void createDraft()
        return
      }

      // Save: cmd/ctrl+s
      if (key === 's' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        void saveActive()
        return
      }

      // Command palette / fuzzy search: cmd/ctrl+p
      if (key === 'p' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        openCommandPalette()
        return
      }

      // Close tab: cmd/ctrl+w
      if (key === 'w' && !e.shiftKey && !e.altKey) {
        if (activeTabId) {
          e.preventDefault()
          closeTab(activeTabId)
        }
        return
      }

      // Settings: cmd/ctrl+,
      if (e.key === ',' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        openSettings()
        return
      }

      // Toggle sidebar: cmd/ctrl+.
      if (e.key === '.' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        void toggleSidebar()
        return
      }

      // Toggle editor mode: cmd/ctrl+/
      if (e.key === '/' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        void setEditorMode(editorMode === 'visual' ? 'raw' : 'visual')
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
    createDraft,
    saveActive,
    closeTab,
    activeTabId,
    toggleSidebar,
    setEditorMode,
    editorMode,
    tabs,
    setActiveTab,
    openSettings,
    openCommandPalette
  ])
}
