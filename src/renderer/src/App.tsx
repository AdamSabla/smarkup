import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import TitleBar from '@/components/TitleBar'
import Sidebar from '@/components/Sidebar'
import TabBar from '@/components/TabBar'
import UpdateBanner from '@/components/UpdateBanner'
import EditorPane from '@/components/editor/EditorPane'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useUpdateSubscription } from '@/hooks/useUpdateSubscription'
import { useWorkspace } from '@/store/workspace'

const App = (): React.JSX.Element => {
  const sidebarVisible = useWorkspace((s) => s.sidebarVisible)
  useShortcuts()
  useUpdateSubscription()

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <TitleBar />
      <UpdateBanner />
      <div className="flex min-h-0 flex-1">
        <ResizablePanelGroup direction="horizontal">
          {sidebarVisible && (
            <>
              <ResizablePanel defaultSize={20} minSize={12} maxSize={40}>
                <Sidebar />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}
          <ResizablePanel defaultSize={80}>
            <div className="flex h-full flex-col">
              <TabBar />
              <div className="min-h-0 flex-1">
                <EditorPane />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  )
}

export default App
