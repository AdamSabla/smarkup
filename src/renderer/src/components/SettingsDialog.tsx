import { FolderOpenIcon, MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'
import type { Theme } from '../../../preload'

type ThemeOption = { value: Theme; label: string; icon: React.ElementType }

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon }
]

const SettingsDialog = (): React.JSX.Element => {
  const {
    settingsOpen,
    closeSettings,
    draftsFolder,
    setDraftsFolder,
    theme,
    setTheme,
    autoSave,
    setAutoSave,
    showWordCount,
    setShowWordCount
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
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
