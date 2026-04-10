import { useState } from 'react'
import { FilePlusIcon, FolderPlusIcon, FileTextIcon, XIcon, SettingsIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useWorkspace, type SidebarSection } from '@/store/workspace'

const INITIAL_VISIBLE = 10

type SectionViewProps = {
  section: SidebarSection
  onRemove?: () => void
}

const SectionView = ({ section, onRemove }: SectionViewProps): React.JSX.Element => {
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const { openFile, activeTabId, createDraft } = useWorkspace()

  const files = showAll ? section.files : section.files.slice(0, INITIAL_VISIBLE)
  const hidden = section.files.length - INITIAL_VISIBLE

  return (
    <div className="mb-3">
      <div className="group flex items-center gap-1 px-2 pt-1 pb-0.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
        >
          {section.label}
        </button>

        {section.isDrafts && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5 opacity-0 group-hover:opacity-100"
            onClick={createDraft}
            aria-label="New draft"
          >
            <FilePlusIcon className="size-3" />
          </Button>
        )}

        {!section.isDrafts && onRemove && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5 opacity-0 group-hover:opacity-100"
            onClick={onRemove}
            aria-label={`Remove ${section.label}`}
          >
            <XIcon className="size-3" />
          </Button>
        )}
      </div>

      {expanded && (
        <>
          {section.isDrafts && !section.path && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">
              Set a drafts folder in Settings to enable ⌘N.
            </div>
          )}

          {files.length === 0 && section.path && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">No markdown files</div>
          )}

          {files.map((file) => {
            const active = file.path === activeTabId
            return (
              <button
                key={file.path}
                onClick={() => openFile(file.path)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  active && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                )}
              >
                <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{file.name.replace(/\.md$/i, '')}</span>
              </button>
            )
          })}

          {hidden > 0 && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full px-2 py-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Show {hidden} more
            </button>
          )}
          {showAll && hidden > 0 && (
            <button
              onClick={() => setShowAll(false)}
              className="w-full px-2 py-1 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Show fewer
            </button>
          )}
        </>
      )}
    </div>
  )
}

const Sidebar = (): React.JSX.Element => {
  const { sections, addFolder, removeFolder, openSettings } = useWorkspace()

  const handleAddFolder = async (): Promise<void> => {
    const chosen = await window.api.openDirectory()
    if (chosen) await addFolder(chosen)
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <ScrollArea className="flex-1 px-1 pt-2">
        {sections.map((section) => (
          <SectionView
            key={section.id}
            section={section}
            onRemove={
              section.isDrafts ? undefined : () => void removeFolder(section.path ?? section.id)
            }
          />
        ))}
      </ScrollArea>

      <div className="flex items-center gap-1 border-t border-border/50 px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 flex-1 justify-start gap-2 px-2 text-xs"
          onClick={handleAddFolder}
        >
          <FolderPlusIcon className="size-3.5" />
          Add folder
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={openSettings}
          aria-label="Settings"
        >
          <SettingsIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

export default Sidebar
