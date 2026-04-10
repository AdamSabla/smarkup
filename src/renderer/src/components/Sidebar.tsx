import { FilePlusIcon, FolderOpenIcon, FileTextIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

const Sidebar = (): React.JSX.Element => {
  const { rootPath, entries, activeTabId, setRoot, openFile, createFileInRoot } = useWorkspace()

  const handleChooseRoot = async (): Promise<void> => {
    const chosen = await window.api.openDirectory()
    if (chosen) await setRoot(chosen)
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {rootPath ? rootPath.split('/').pop() : 'No folder'}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={handleChooseRoot}
            aria-label="Open folder"
          >
            <FolderOpenIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={createFileInRoot}
            disabled={!rootPath}
            aria-label="New file"
          >
            <FilePlusIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 px-1">
        {!rootPath && (
          <div className="flex flex-col items-start gap-2 px-2 py-6 text-xs text-muted-foreground">
            <p>Pick a folder to start editing local markdown files.</p>
            <Button size="sm" variant="outline" onClick={handleChooseRoot}>
              <FolderOpenIcon className="size-3.5" />
              Open folder
            </Button>
          </div>
        )}
        {entries
          .filter((e) => !e.isDirectory && e.name.endsWith('.md'))
          .map((entry) => {
            const active = entry.path === activeTabId
            return (
              <button
                key={entry.path}
                onClick={() => openFile(entry.path)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                )}
              >
                <FileTextIcon className="size-3.5 text-muted-foreground" />
                <span className="truncate">{entry.name.replace(/\.md$/, '')}</span>
              </button>
            )
          })}
      </ScrollArea>
    </div>
  )
}

export default Sidebar
