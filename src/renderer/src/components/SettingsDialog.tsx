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
  const { settingsOpen, closeSettings, draftsFolder, setDraftsFolder, theme, setTheme } =
    useWorkspace()

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
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default SettingsDialog
