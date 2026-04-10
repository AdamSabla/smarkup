import { EyeIcon, CodeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'
import VisualEditor from './VisualEditor'
import RawEditor from './RawEditor'

const EmptyState = (): React.JSX.Element => (
  <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
    <h1 className="text-lg font-medium">smarkup</h1>
    <p className="text-sm">Open a folder and pick a file — or create a new one.</p>
  </div>
)

const ModeSwitcher = (): React.JSX.Element => {
  const { editorMode, setEditorMode } = useWorkspace()
  return (
    <div className="flex items-center rounded-md border bg-background p-0.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void setEditorMode('visual')}
        className={cn(
          'h-6 px-2 text-xs',
          editorMode === 'visual' && 'bg-accent text-accent-foreground'
        )}
      >
        <EyeIcon className="size-3" />
        Visual
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void setEditorMode('raw')}
        className={cn(
          'h-6 px-2 text-xs',
          editorMode === 'raw' && 'bg-accent text-accent-foreground'
        )}
      >
        <CodeIcon className="size-3" />
        Raw
      </Button>
    </div>
  )
}

const EditorPane = (): React.JSX.Element => {
  const { tabs, activeTabId, editorMode, updateActiveContent } = useWorkspace()
  const active = tabs.find((t) => t.id === activeTabId)

  if (!active) return <EmptyState />

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end border-b border-border/50 px-3 py-1.5">
        <ModeSwitcher />
      </div>
      <div className="flex-1 overflow-hidden">
        {editorMode === 'visual' ? (
          <VisualEditor key={active.id} value={active.content} onChange={updateActiveContent} />
        ) : (
          <RawEditor key={active.id} value={active.content} onChange={updateActiveContent} />
        )}
      </div>
    </div>
  )
}

export default EditorPane
