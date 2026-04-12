import { useMemo } from 'react'
import { useWorkspace } from '@/store/workspace'
import { countWords } from '@/lib/text-stats'
import VisualEditor from './VisualEditor'
import RawEditor from './RawEditor'

const EmptyState = (): React.JSX.Element => (
  <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
    <h1 className="text-lg font-medium">smarkup</h1>
    <p className="text-sm">Open a folder and pick a file — or create a new one.</p>
  </div>
)

const EditorPane = (): React.JSX.Element => {
  const { tabs, activeTabId, editorMode, updateActiveContent, showWordCount } = useWorkspace()
  const active = tabs.find((t) => t.id === activeTabId)

  const words = useMemo(() => {
    if (!active) return 0
    return countWords(active.content)
  }, [active?.content])

  if (!active) return <EmptyState />

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        {editorMode === 'visual' ? (
          <VisualEditor
            key={active.id}
            tabId={active.id}
            value={active.content}
            onChange={updateActiveContent}
          />
        ) : (
          <RawEditor
            key={active.id}
            tabId={active.id}
            value={active.content}
            onChange={updateActiveContent}
          />
        )}
      </div>
      {showWordCount && words > 0 && (
        <span className="absolute bottom-2 right-3 text-[11px] tabular-nums text-muted-foreground">
          {words.toLocaleString()} words
        </span>
      )}
    </div>
  )
}

export default EditorPane
