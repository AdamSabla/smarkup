import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import SidebarHeader from '@/components/SidebarHeader'
import UpdateBanner from '@/components/UpdateBanner'
import SettingsDialog from '@/components/SettingsDialog'
import QuickOpen from '@/components/QuickOpen'
import CommandPalette from '@/components/CommandPalette'
import KeyboardShortcuts from '@/components/KeyboardShortcuts'
import UnsavedChangesDialog from '@/components/UnsavedChangesDialog'
import FolderDropZone from '@/components/FolderDropZone'
import Toast from '@/components/Toast'
import VariablesPanel from '@/components/VariablesPanel'
import DiffPickerDialog from '@/components/DiffPickerDialog'
import SplitContainer from '@/components/editor/SplitContainer'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useUpdateSubscription } from '@/hooks/useUpdateSubscription'
import { useTheme } from '@/hooks/useTheme'
import { useFileWatcher } from '@/hooks/useFileWatcher'
import { usePersistOpenTabs } from '@/hooks/usePersistOpenTabs'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useAutoFilename } from '@/hooks/useAutoFilename'
import { useWorkspace } from '@/store/workspace'

const SIDEBAR_DEFAULT = 240
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 500

const App = (): React.JSX.Element => {
  const sidebarVisible = useWorkspace((s) => s.sidebarVisible)
  const hydrate = useWorkspace((s) => s.hydrate)
  const paneRoot = useWorkspace((s) => s.paneRoot)
  const requestCloseWindow = useWorkspace((s) => s.requestCloseWindow)

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const dragging = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragging.current = true
      startX.current = e.clientX
      startWidth.current = sidebarWidth
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [sidebarWidth]
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const delta = e.clientX - startX.current
    setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth.current + delta)))
  }, [])

  const onPointerUp = useCallback(() => {
    dragging.current = false
  }, [])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Intercept close requests from the main process (red X, Cmd+Q, etc.)
  // so we can prompt about unsaved changes before the window goes away.
  useEffect(() => {
    return window.api.onCloseRequested(() => {
      requestCloseWindow()
    })
  }, [requestCloseWindow])

  // View → Show Variables Panel in the native menu sends this event;
  // route it through the store so the toggle is persisted.
  useEffect(() => {
    return window.api.onToggleVariablesPanel(() => {
      void useWorkspace.getState().toggleVariablesPanel()
    })
  }, [])

  // Main forwards file paths here when the OS asks us to open a file —
  // "Open With…" in Finder, file double-click on Win/Linux, File → Open…,
  // or a `.md` dropped onto the window. These are *external* requests, so
  // promote the file to the top of Recents (in-app navigation doesn't).
  useEffect(() => {
    return window.api.onOpenFileFromDisk((path) => {
      void useWorkspace.getState().openFile(path, { source: 'external' })
    })
  }, [])

  // View → Compare Files… in the native menu
  useEffect(() => {
    return window.api.onOpenDiffPicker(() => {
      useWorkspace.getState().openDiffPicker()
    })
  }, [])

  // File menu actions routed from the native menu bar
  useEffect(() => {
    return window.api.onNewDraft(() => {
      void useWorkspace.getState().createDraft()
    })
  }, [])
  useEffect(() => {
    return window.api.onSave(() => {
      void useWorkspace.getState().saveActive()
    })
  }, [])
  useEffect(() => {
    return window.api.onSaveAs(() => {
      void useWorkspace.getState().saveActiveAs()
    })
  }, [])
  useEffect(() => {
    return window.api.onDuplicateFile(() => {
      const s = useWorkspace.getState()
      const tab = s.activeTabId ? s.tabs.find((t) => t.id === s.activeTabId) : undefined
      if (!tab || tab.path.startsWith('draft://')) return
      ;(async (): Promise<void> => {
        const dir = await window.api.dirname(tab.path)
        const ext = tab.name.includes('.') ? '.' + tab.name.split('.').pop()! : ''
        const base = tab.name.replace(/\.[^.]+$/, '')
        const trailingNum = base.match(/^(.*?)(\d+)$/)
        const copyName = trailingNum
          ? `${trailingNum[1]}${Number(trailingNum[2]) + 1}${ext}`
          : `${base} copy${ext}`
        const newPath = await window.api.createFile(dir, copyName)
        await window.api.writeFile(newPath, tab.content)
        void useWorkspace.getState().openFile(newPath)
        requestAnimationFrame(() => useWorkspace.getState().startRenamingTab())
      })()
    })
  }, [])
  useEffect(() => {
    return window.api.onRenameFile(() => {
      if (useWorkspace.getState().activeTabId) {
        useWorkspace.getState().startRenamingTab()
      }
    })
  }, [])
  useEffect(() => {
    return window.api.onReopenClosedTab(() => {
      void useWorkspace.getState().reopenClosedTab()
    })
  }, [])
  useEffect(() => {
    return window.api.onOpenSettings(() => {
      useWorkspace.getState().openSettings()
    })
  }, [])
  useEffect(() => {
    return window.api.onToggleSidebar(() => {
      void useWorkspace.getState().toggleSidebar()
    })
  }, [])
  useEffect(() => {
    return window.api.onOpenFindBar(() => {
      useWorkspace.getState().openFindBar()
    })
  }, [])

  useShortcuts()
  useUpdateSubscription()
  useTheme()
  useFileWatcher()
  usePersistOpenTabs()
  useAutoSave()
  useAutoFilename()

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        {sidebarVisible && (
          <>
            <div
              className="flex h-full shrink-0 flex-col overflow-hidden"
              style={{ width: sidebarWidth }}
            >
              <SidebarHeader />
              <div className="min-h-0 flex-1 overflow-hidden">
                <Sidebar />
              </div>
            </div>
            <div
              className="relative flex w-px shrink-0 cursor-col-resize items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 hover:bg-ring/40"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1">
              <SplitContainer node={paneRoot} />
            </div>
            <VariablesPanel />
          </div>
        </div>
      </div>
      <SettingsDialog />
      <QuickOpen />
      <CommandPalette />
      <KeyboardShortcuts />
      <UnsavedChangesDialog />
      <DiffPickerDialog />
      <FolderDropZone />
      <Toast />
      <UpdateBanner />
    </div>
  )
}

export default App
