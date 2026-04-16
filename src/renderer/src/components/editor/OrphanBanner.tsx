import { AlertTriangleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/store/workspace'

type Props = {
  tabId: string
}

/**
 * Shown at the top of an editor when the underlying file has been deleted
 * externally while the tab has unsaved edits. Gives the user two paths
 * forward: "Save as…" (pick a new location and migrate the tab) or
 * "Discard" (drop the tab + its in-memory edits).
 *
 * The tab stays open until the user picks one — autosave is paused for
 * orphaned tabs (see useAutoSave) so we don't secretly re-create the file
 * at its old path behind their back.
 */
const OrphanBanner = ({ tabId }: Props): React.JSX.Element | null => {
  const tab = useWorkspace((s) => s.tabs.find((t) => t.id === tabId))
  const isOrphan = useWorkspace((s) => (tab ? s.orphanedPaths.has(tab.path) : false))
  const saveAs = useWorkspace((s) => s.saveOrphanedTabAs)
  const discard = useWorkspace((s) => s.discardOrphanedTab)

  if (!tab || !isOrphan) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-drag flex shrink-0 items-center justify-between gap-3 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
    >
      <span className="flex min-w-0 items-center gap-2">
        <AlertTriangleIcon className="size-3.5 shrink-0" />
        <span className="truncate">
          “{tab.name}” was deleted externally. Your edits are still here.
        </span>
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          className="h-6 px-2 text-xs"
          onClick={() => {
            void saveAs(tabId)
          }}
        >
          Save as…
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs hover:bg-destructive/15"
          onClick={() => discard(tabId)}
        >
          Discard
        </Button>
      </div>
    </div>
  )
}

export default OrphanBanner
