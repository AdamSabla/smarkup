import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useWorkspace, type PaneNode } from '@/store/workspace'
import { cn } from '@/lib/utils'
import PaneTabBar from './PaneTabBar'
import EditorPane from './EditorPane'
import OutlinePanel from './OutlinePanel'

type SplitContainerProps = {
  node: PaneNode
  isFirst?: boolean
  isLast?: boolean
}

const SplitContainer = ({
  node,
  isFirst = true,
  isLast = true
}: SplitContainerProps): React.JSX.Element => {
  const activePaneId = useWorkspace((s) => s.activePaneId)
  const resizePanes = useWorkspace((s) => s.resizePanes)
  const paneRoot = useWorkspace((s) => s.paneRoot)
  const outlineSide = useWorkspace((s) => s.outlinePanelSide)
  const isMultiPane = paneRoot.type === 'split'

  if (node.type === 'leaf') {
    const isActive = activePaneId === node.id
    return (
      <div
        className={cn(
          'flex h-full flex-col',
          isMultiPane && 'ring-inset',
          isMultiPane && isActive && 'ring-1 ring-primary/30'
        )}
      >
        <PaneTabBar paneId={node.id} isFirst={isFirst} isLast={isLast} />
        {/* The outline docks inside the pane, under the tab bar: it belongs to
            the document you're reading, so it follows the tab rather than the
            window. */}
        <div className="flex min-h-0 flex-1">
          {outlineSide === 'left' && <OutlinePanel tabId={node.activeTabId} paneId={node.id} />}
          <div className="min-w-0 flex-1">
            <EditorPane tabId={node.activeTabId} paneId={node.id} />
          </div>
          {outlineSide === 'right' && <OutlinePanel tabId={node.activeTabId} paneId={node.id} />}
        </div>
      </div>
    )
  }

  const handleResize = (layout: Record<string, number>): void => {
    const values = Object.values(layout)
    if (values.length === 2) {
      resizePanes(node.id, [values[0], values[1]])
    }
  }

  return (
    <ResizablePanelGroup direction={node.direction} onLayoutChange={handleResize}>
      <ResizablePanel defaultSize={`${node.sizes[0]}%`} minSize="10%">
        <SplitContainer node={node.children[0]} isFirst={isFirst} isLast={false} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={`${node.sizes[1]}%`} minSize="10%">
        <SplitContainer node={node.children[1]} isFirst={false} isLast />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

export default SplitContainer
