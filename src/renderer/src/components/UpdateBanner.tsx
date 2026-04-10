import { DownloadIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/store/workspace'

const UpdateBanner = (): React.JSX.Element | null => {
  const status = useWorkspace((s) => s.updateStatus)
  const [dismissed, setDismissed] = useState(false)

  if (status.kind !== 'available' || dismissed) return null

  const handleDownload = (): void => {
    void window.api.openReleaseUrl(status.releaseUrl)
  }

  return (
    <div className="no-drag flex h-8 shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-primary px-3 text-primary-foreground">
      <span className="text-xs font-medium">Update available: smarkup v{status.version}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={handleDownload}>
          <DownloadIcon className="size-3" />
          Download
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <XIcon className="size-3" />
        </Button>
      </div>
    </div>
  )
}

export default UpdateBanner
