import { EyeIcon, FileCodeIcon, FolderOpenIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useWorkspace, type EditorMode } from '@/store/workspace'
import type { Theme } from '../../../preload'

type ThemeOption = { value: Theme; label: string; icon: React.ElementType }

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon }
]

type EditorModeOption = { value: EditorMode; label: string; icon: React.ElementType }

const EDITOR_MODE_OPTIONS: EditorModeOption[] = [
  { value: 'visual', label: 'Visual', icon: EyeIcon },
  { value: 'raw', label: 'Raw', icon: FileCodeIcon }
]

const SettingsDialog = (): React.JSX.Element => {
  const {
    settingsOpen,
    closeSettings,
    draftsFolder,
    setDraftsFolder,
    theme,
    setTheme,
    editorMode,
    setDefaultEditorMode,
    autoSave,
    setAutoSave,
    showWordCount,
    setShowWordCount,
    rawHeadingSizes,
    setRawHeadingSizes,
    visualSyntaxHighlight,
    setVisualSyntaxHighlight,
    visualHeadingMarkers,
    setVisualHeadingMarkers,
    showRecents,
    setShowRecents,
    showTabParentFolder,
    setShowTabParentFolder
  } = useWorkspace()

  const handlePickDraftsFolder = async (): Promise<void> => {
    const chosen = await window.api.openDirectory()
    if (chosen) await setDraftsFolder(chosen)
  }

  return (
    <Dialog open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your workspace.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* Drafts folder */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Drafts folder</label>
              <Button size="sm" variant="outline" onClick={handlePickDraftsFolder}>
                <FolderOpenIcon className="size-3.5" />
                Choose
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              New files created with ⌘N / ⌘T will be placed here.
            </p>
            <div
              className={cn(
                'rounded-md border bg-muted/30 px-3 py-2 text-xs',
                draftsFolder ? 'font-mono text-foreground' : 'italic text-muted-foreground'
              )}
            >
              {draftsFolder ?? 'Not set'}
            </div>
          </div>

          {/* Theme */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Appearance</label>
            <div className="flex gap-2">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  variant={theme === value ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => void setTheme(value)}
                >
                  <Icon className="size-3.5" />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {/* Default editor */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Default editor</label>
            <p className="text-xs text-muted-foreground">
              How files open when they have no saved preference yet. Switching the editor for a file
              remembers that choice for the file.
            </p>
            <div className="flex gap-2">
              {EDITOR_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  variant={editorMode === value ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => void setDefaultEditorMode(value)}
                >
                  <Icon className="size-3.5" />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {/* Recents in sidebar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium">Show Recents in sidebar</label>
                <p className="text-xs text-muted-foreground">
                  Display the Recents section at the top of the sidebar.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showRecents}
                onClick={() => void setShowRecents(!showRecents)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                  showRecents ? 'bg-primary border-primary' : 'bg-muted border-border'
                )}
              >
                <span
                  className={cn(
                    'inline-block size-3.5 rounded-full bg-background shadow transition-transform',
                    showRecents ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Parent folder in tab labels */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium">Show parent folder in tab name</label>
                <p className="text-xs text-muted-foreground">
                  Label tabs “folder / file” so same-named files in different folders can be told
                  apart.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showTabParentFolder}
                onClick={() => void setShowTabParentFolder(!showTabParentFolder)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                  showTabParentFolder ? 'bg-primary border-primary' : 'bg-muted border-border'
                )}
              >
                <span
                  className={cn(
                    'inline-block size-3.5 rounded-full bg-background shadow transition-transform',
                    showTabParentFolder ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Auto-save */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium">Auto-save</label>
                <p className="text-xs text-muted-foreground">
                  Save the active file automatically after 1.5 s of inactivity.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoSave}
                onClick={() => void setAutoSave(!autoSave)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                  autoSave ? 'bg-primary border-primary' : 'bg-muted border-border'
                )}
              >
                <span
                  className={cn(
                    'inline-block size-3.5 rounded-full bg-background shadow transition-transform',
                    autoSave ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Word count */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium">Word count</label>
                <p className="text-xs text-muted-foreground">
                  Show the word count at the bottom-right of the editor.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showWordCount}
                onClick={() => void setShowWordCount(!showWordCount)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                  showWordCount ? 'bg-primary border-primary' : 'bg-muted border-border'
                )}
              >
                <span
                  className={cn(
                    'inline-block size-3.5 rounded-full bg-background shadow transition-transform',
                    showWordCount ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  )}
                />
              </button>
            </div>
          </div>
          {/* Visual syntax highlight */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium">Syntax colors in visual editor</label>
                <p className="text-xs text-muted-foreground">
                  Color headings, bold, and code in the visual editor to match the raw editor.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={visualSyntaxHighlight}
                onClick={() => void setVisualSyntaxHighlight(!visualSyntaxHighlight)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                  visualSyntaxHighlight ? 'bg-primary border-primary' : 'bg-muted border-border'
                )}
              >
                <span
                  className={cn(
                    'inline-block size-3.5 rounded-full bg-background shadow transition-transform',
                    visualSyntaxHighlight ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  )}
                />
              </button>
            </div>
          </div>
          {/* Heading level markers */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium">Heading levels in visual editor</label>
                <p className="text-xs text-muted-foreground">
                  Show an H1–H4 tag in the margin next to each heading, so the hierarchy is visible
                  without counting #.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={visualHeadingMarkers}
                onClick={() => void setVisualHeadingMarkers(!visualHeadingMarkers)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                  visualHeadingMarkers ? 'bg-primary border-primary' : 'bg-muted border-border'
                )}
              >
                <span
                  className={cn(
                    'inline-block size-3.5 rounded-full bg-background shadow transition-transform',
                    visualHeadingMarkers ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Raw heading sizes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm font-medium">Heading sizes in raw editor</label>
                <p className="text-xs text-muted-foreground">
                  Scale heading font sizes (H1–H4) in the raw markdown editor.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={rawHeadingSizes}
                onClick={() => void setRawHeadingSizes(!rawHeadingSizes)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
                  rawHeadingSizes ? 'bg-primary border-primary' : 'bg-muted border-border'
                )}
              >
                <span
                  className={cn(
                    'inline-block size-3.5 rounded-full bg-background shadow transition-transform',
                    rawHeadingSizes ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  )}
                />
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
