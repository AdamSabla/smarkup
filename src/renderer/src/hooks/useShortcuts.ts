import { useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')
const mod = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey)

export const useShortcuts = (): void => {
  const {
    createDraft,
    saveActive,
    requestCloseTab,
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
    openSettings,
    openQuickOpen,
    openCommandPalette,
    startRenamingTab,
    openShortcuts
  } = useWorkspace()

  // Tab-switch shortcuts (cmd+opt+arrow, ctrl+tab) must run in the capture
  // phase so they fire BEFORE the editor processes alt+arrow as "move by word"
  // and corrupts the scroll position.
  useEffect(() => {
    const captureHandler = (e: KeyboardEvent): void => {
      if (!mod(e)) return
      if (
        (e.key === 'Tab' && e.ctrlKey) ||
        (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
      ) {
        e.preventDefault()
        e.stopPropagation()
        if (tabs.length === 0) return
        const idx = tabs.findIndex((t) => t.id === activeTabId)
        const dir = e.key === 'ArrowLeft' || e.shiftKey ? -1 : 1
        const next = tabs[(idx + dir + tabs.length) % tabs.length]
        setActiveTab(next.id)
      }
    }

    window.addEventListener('keydown', captureHandler, true)
    return () => window.removeEventListener('keydown', captureHandler, true)
  }, [tabs, activeTabId, setActiveTab])

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
        // If we're in a split, close the pane instead of the tab.
        // (Panes are stateless views over a tab — closing a pane doesn't
        // lose any unsaved work, so no prompt is needed here.)
        if (paneRoot.type === 'split') {
          closePane(activePaneId)
        } else if (activeTabId) {
          requestCloseTab(activeTabId)
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

      // Keyboard shortcuts: cmd/ctrl+shift+/
      if (e.key === '/' && e.shiftKey && !e.altKey) {
        e.preventDefault()
        openShortcuts()
        return
      }

      // Toggle editor mode: cmd/ctrl+;
      if (e.key === ';' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        void setEditorMode(editorMode === 'visual' ? 'raw' : 'visual')
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [
    createDraft,
    saveActive,
    requestCloseTab,
    closePane,
    activeTabId,
    activePaneId,
    paneRoot,
    splitPane,
    toggleSidebar,
    setEditorMode,
    editorMode,
    openSettings,
    openQuickOpen,
    openCommandPalette,
    startRenamingTab,
    openShortcuts
  ])
}
