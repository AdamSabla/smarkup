import { useCallback, useEffect, useRef, useState } from 'react'
import TopBar from '@/components/TopBar'
import Sidebar from '@/components/Sidebar'
import UpdateBanner from '@/components/UpdateBanner'
import SettingsDialog from '@/components/SettingsDialog'
import QuickOpen from '@/components/QuickOpen'
import CommandPalette from '@/components/CommandPalette'
import KeyboardShortcuts from '@/components/KeyboardShortcuts'
import UnsavedChangesDialog from '@/components/UnsavedChangesDialog'
import FolderDropZone from '@/components/FolderDropZone'
import Toast from '@/components/Toast'
import VariablesPanel from '@/components/VariablesPanel'
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

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current = e.clientX
    startWidth.current = sidebarWidth
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [sidebarWidth])

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
  // or a `.md` dropped onto the window. Routing through the store's
  // `openFile` action adds it to Recents and swaps it into the active pane.
  useEffect(() => {
    return window.api.onOpenFileFromDisk((path) => {
      void useWorkspace.getState().openFile(path)
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
      <TopBar />
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        {sidebarVisible && (
          <>
            <div className="h-full shrink-0 overflow-hidden" style={{ width: sidebarWidth }}>
              <Sidebar />
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
      <FolderDropZone />
      <Toast />
    </div>
  )
}

export default App
