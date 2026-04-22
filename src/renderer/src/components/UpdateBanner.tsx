import {
  AlertTriangleIcon,
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Loader2Icon,
  RotateCwIcon,
  XIcon
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'

/**
 * Update notifier. Renders as a bottom-right anchored pill/card overlay.
 * Transient informational states (`checking` / `not-available` triggered by
 * the user) are routed through the shared bottom-center `Toast` so the app
 * has one consistent surface for quick notices; persistent states
 * (download progress, "ready to install", and actionable errors) live in
 * the corner card and stay until the user acts on them.
 *
 * Background checks stay silent for everything except "an update was found"
 * — same behaviour as before, just with a less intrusive surface.
 */
const UpdateBanner = (): React.JSX.Element | null => {
  const status = useWorkspace((s) => s.updateStatus)
  const showToast = useWorkspace((s) => s.showToast)

  // Track which status instance the user has manually dismissed so a later
  // status transition (e.g. the next check) shows the notifier again.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  // Key a status by its kind plus any identifying payload. The `checkId` on
  // `not-available` / `error` is what keeps two separate checks distinct —
  // the shape is otherwise identical, so without the id an auto-dismissed
  // "up to date" would silently suppress the next check's result the same
  // session.
  const statusKey =
    status.kind === 'available'
      ? `available:${status.version}`
      : status.kind === 'downloading'
        ? `downloading:${status.version}`
        : status.kind === 'downloaded'
          ? `downloaded:${status.version}`
          : status.kind === 'not-available'
            ? `not-available:${status.checkId}`
            : status.kind === 'error'
              ? `error:${status.checkId}:${status.message}`
              : status.kind

  // Route transient user-initiated states to the shared bottom-center
  // toast. We key the effect on `statusKey` so we fire exactly once per
  // distinct status instance — re-renders from unrelated state changes
  // don't re-toast.
  useEffect(() => {
    if (status.kind === 'checking' && status.userInitiated) {
      showToast('Checking for updates…')
    } else if (status.kind === 'not-available' && status.userInitiated) {
      showToast(`You're up to date (smarkup v${status.currentVersion})`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey])

  // Decide whether to render the corner notifier. Background checks stay
  // silent for anything other than `available`; the transient states above
  // have already been handed off to the toast. Download + install states
  // always show — once an update is in-flight the user should be able to
  // see and control it.
  const shouldShow = ((): boolean => {
    if (dismissedKey === statusKey) return false
    switch (status.kind) {
      case 'available':
      case 'downloading':
      case 'downloaded':
        return true
      case 'error':
        return status.userInitiated
      case 'checking':
      case 'not-available':
      case 'idle':
      default:
        return false
    }
  })()

  if (!shouldShow) return null

  const dismiss = (): void => setDismissedKey(statusKey)

  if (status.kind === 'available') {
    // With autoDownload enabled this state is usually transient — the
    // updater fires `download-progress` almost immediately and we move to
    // `downloading`. We still render a labelled "Preparing download…" so a
    // slow-to-start download doesn't look like nothing is happening.
    return (
      <Anchor>
        <Pill>
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            Preparing update v{status.version}…
          </span>
          <DismissButton onClick={dismiss} />
        </Pill>
      </Anchor>
    )
  }

  if (status.kind === 'downloading') {
    const percent = Math.max(0, Math.min(100, Math.round(status.percent)))
    return (
      <Anchor>
        <Pill>
          <DownloadIcon className="size-3.5 shrink-0 text-primary" />
          <span className="shrink-0 text-xs font-medium">Downloading v{status.version}</span>
          <ProgressBar percent={percent} />
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {percent}%
          </span>
          <DismissButton onClick={dismiss} />
        </Pill>
      </Anchor>
    )
  }

  if (status.kind === 'downloaded') {
    const restart = (): void => {
      void window.api.quitAndInstallUpdate()
    }
    return (
      <Anchor>
        <Card tone="primary">
          <div className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Update ready to install</div>
              <div className="text-xs text-muted-foreground">
                smarkup v{status.version} is ready. Restart to apply.
              </div>
            </div>
            <DismissButton onClick={dismiss} label="Install later" />
          </div>
          <div className="mt-2 flex items-center justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={dismiss}>
              Later
            </Button>
            <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={restart}>
              <RotateCwIcon className="size-3" />
              Restart now
            </Button>
          </div>
        </Card>
      </Anchor>
    )
  }

  if (status.kind === 'error') {
    const retry = (): void => {
      void useWorkspace.getState().checkForUpdates()
    }
    const openRelease = status.releaseUrl
      ? (): void => {
          void window.api.openReleaseUrl(status.releaseUrl as string)
        }
      : null
    return (
      <Anchor>
        <Card tone="destructive">
          <div className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Couldn&rsquo;t install update</div>
              <div className="line-clamp-3 text-xs text-muted-foreground">{status.message}</div>
            </div>
            <DismissButton onClick={dismiss} />
          </div>
          <div className="mt-2 flex items-center justify-end gap-1">
            {openRelease && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={openRelease}>
                <ExternalLinkIcon className="size-3" />
                Download manually
              </Button>
            )}
            <Button size="sm" variant="default" className="h-7 px-2 text-xs" onClick={retry}>
              Retry
            </Button>
          </div>
        </Card>
      </Anchor>
    )
  }

  return null
}

type Tone = 'primary' | 'destructive'

// Outer positioning wrapper. `pointer-events-none` on the wrapper means the
// empty area around the card never blocks clicks on the editor / sidebar;
// the card itself restores `pointer-events-auto` so its buttons work.
const Anchor = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    role="status"
    aria-live="polite"
    className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-sm justify-end"
  >
    {children}
  </div>
)

// Single-row compact surface for progress-y states where the content fits
// on one line and a taller card would feel heavy.
const Pill = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-md border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
    {children}
  </div>
)

// Two-line surface used for states that need explanation + actions.
const Card = ({ tone, children }: { tone: Tone; children: React.ReactNode }): React.JSX.Element => (
  <div
    className={cn(
      'pointer-events-auto w-80 max-w-full rounded-md border bg-background/95 p-3 shadow-lg backdrop-blur-sm',
      tone === 'destructive' ? 'border-destructive/40' : 'border-border'
    )}
  >
    {children}
  </div>
)

const DismissButton = ({
  onClick,
  label = 'Dismiss'
}: {
  onClick: () => void
  label?: string
}): React.JSX.Element => (
  <Button
    size="icon"
    variant="ghost"
    className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
    onClick={onClick}
    aria-label={label}
    title={label}
  >
    <XIcon className="size-3.5" />
  </Button>
)

// Slim inline progress indicator; stays narrow so the pill doesn't grow.
const ProgressBar = ({ percent }: { percent: number }): React.JSX.Element => (
  <span className="relative h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
    <span
      className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-200"
      style={{ width: `${percent}%` }}
    />
  </span>
)

export default UpdateBanner
