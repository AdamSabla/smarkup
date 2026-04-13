import { useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')
const mod = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey)

export const useShortcuts = (): void => {
  const {
    createDraft,
    saveActive,
    closeTab,
    closePane,
    activeTabId,
    activePaneId,
    paneRoot,
    splitPane,
    toggleSidebar,
    setEditorMode,
    editorMode,
    tabs,
    setActiveTab,
    setActivePane,
    openSettings,
    openQuickOpen,
    openCommandPalette,
    startRenamingTab
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

      // Quick open / fuzzy file finder: cmd/ctrl+p
      if (key === 'p' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        openQuickOpen()
        return
      }

      // Command palette: cmd/ctrl+k
      if (key === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        openCommandPalette()
        return
      }

      // Rename active file: cmd/ctrl+r
      if (key === 'r' && !e.shiftKey && !e.altKey) {
        if (activeTabId) {
          e.preventDefault()
          startRenamingTab()
        }
        return
      }

      // Close tab / close pane: cmd/ctrl+w
      if (key === 'w' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        // If we're in a split, close the pane instead of the tab
        if (paneRoot.type === 'split') {
          closePane(activePaneId)
        } else if (activeTabId) {
          closeTab(activeTabId)
        }
        return
      }

      // Split pane: cmd/ctrl+\ (horizontal split)
      if (e.key === '\\' && !e.shiftKey && !e.altKey) {
        if (activeTabId) {
          e.preventDefault()
          splitPane(activePaneId, 'horizontal', activeTabId)
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

      // Next/prev tab: ctrl+tab / ctrl+shift+tab  OR  cmd+opt+→ / cmd+opt+←
      if (
        (e.key === 'Tab' && e.ctrlKey) ||
        (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
      ) {
        e.preventDefault()
        if (tabs.length === 0) return
        const idx = tabs.findIndex((t) => t.id === activeTabId)
        const dir = e.key === 'ArrowLeft' || e.shiftKey ? -1 : 1
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
    closePane,
    activeTabId,
    activePaneId,
    paneRoot,
    splitPane,
    toggleSidebar,
    setEditorMode,
    editorMode,
    tabs,
    setActiveTab,
    setActivePane,
    openSettings,
    openQuickOpen,
    openCommandPalette,
    startRenamingTab
  ])
}
