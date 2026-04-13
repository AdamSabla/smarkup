import { CheckCircle2Icon, DownloadIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/store/workspace'
import type { UpdateStatus } from '../../../preload'

type VisibleStatus = Extract<UpdateStatus, { kind: 'available' | 'downloading' | 'downloaded' }>

// A stable identity for each banner "cycle" the user can dismiss. We use
// `${kind}:${version}` so that when the underlying state transitions
// (e.g. "downloading" → "downloaded") the banner resurfaces even if the user
// dismissed the previous state for that same version.
const keyFor = (status: VisibleStatus): string => `${status.kind}:${status.version}`

const UpdateBanner = (): React.JSX.Element | null => {
  const status = useWorkspace((s) => s.updateStatus)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  // Intentionally don't show anything for idle / checking / not-available /
  // error — those are surfaced via the command-palette action's return value,
  // not by interrupting the user's workspace.
  if (
    status.kind !== 'available' &&
    status.kind !== 'downloading' &&
    status.kind !== 'downloaded'
  ) {
    return null
  }

  const currentKey = keyFor(status)
  if (dismissedKey === currentKey) return null

  const dismiss = (): void => setDismissedKey(currentKey)

  const handleRestart = (): void => {
    setRestarting(true)
    void window.api.quitAndInstallUpdate()
  }

  const renderBody = (): React.JSX.Element => {
    if (status.kind === 'available') {
      return (
        <>
          <div className="flex items-center gap-2">
            <DownloadIcon className="size-3.5" />
            <span className="text-xs font-medium">Downloading smarkup v{status.version}…</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <XIcon className="size-3" />
          </Button>
        </>
      )
    }

    if (status.kind === 'downloading') {
      const pct = Math.max(0, Math.min(100, Math.round(status.percent)))
      return (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <DownloadIcon className="size-3.5 shrink-0" />
            <span className="shrink-0 text-xs font-medium">v{status.version}</span>
            <div
              className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-primary-foreground/20"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div
                className="h-full bg-primary-foreground transition-[width] duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 text-xs tabular-nums">{pct}%</span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <XIcon className="size-3" />
          </Button>
        </>
      )
    }

    // downloaded
    return (
      <>
        <div className="flex items-center gap-2">
          <CheckCircle2Icon className="size-3.5" />
          <span className="text-xs font-medium">
            smarkup v{status.version} is ready. Restart to install.
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-xs"
            onClick={handleRestart}
            disabled={restarting}
          >
            <RotateCwIcon className="size-3" />
            {restarting ? 'Restarting…' : 'Restart now'}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-6 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={dismiss}
            aria-label="Install on next quit"
            title="Install on next quit"
          >
            <XIcon className="size-3" />
          </Button>
        </div>
      </>
    )
  }

  return (
    <div className="no-drag flex h-8 shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-primary px-3 text-primary-foreground">
      {renderBody()}
    </div>
  )
}

export default UpdateBanner
