import { useEffect } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import TopBar from '@/components/TopBar'
import Sidebar from '@/components/Sidebar'
import UpdateBanner from '@/components/UpdateBanner'
import SettingsDialog from '@/components/SettingsDialog'
import QuickOpen from '@/components/QuickOpen'
import CommandPalette from '@/components/CommandPalette'
import EditorPane from '@/components/editor/EditorPane'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useUpdateSubscription } from '@/hooks/useUpdateSubscription'
import { useTheme } from '@/hooks/useTheme'
import { useFileWatcher } from '@/hooks/useFileWatcher'
import { usePersistOpenTabs } from '@/hooks/usePersistOpenTabs'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useWorkspace } from '@/store/workspace'

const App = (): React.JSX.Element => {
  const sidebarVisible = useWorkspace((s) => s.sidebarVisible)
  const hydrate = useWorkspace((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useShortcuts()
  useUpdateSubscription()
  useTheme()
  useFileWatcher()
  usePersistOpenTabs()
  useAutoSave()

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <TopBar />
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal">
          {sidebarVisible && (
            <>
              <ResizablePanel defaultSize="240px" minSize="180px" maxSize="500px">
                <Sidebar />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}
          <ResizablePanel>
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <EditorPane />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <SettingsDialog />
      <QuickOpen />
      <CommandPalette />
    </div>
  )
}

export default App
