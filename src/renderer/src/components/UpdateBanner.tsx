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
import { useWorkspace } from '@/store/workspace'

// How long to keep the transient "up to date" / error banners on screen
// after a user-initiated check completes. Matches typical toast dwell time.
const TRANSIENT_DISMISS_MS = 5000

const UpdateBanner = (): React.JSX.Element | null => {
  const status = useWorkspace((s) => s.updateStatus)
  // Track which status instance the user has manually dismissed so a later
  // status transition (e.g. the next check) shows the banner again.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  // Key a status by its kind plus any identifying payload. The `checkId` on
  // `not-available` / `error` is what keeps two separate checks distinct — the
  // shape is otherwise identical, so without the id an auto-dismissed "up to
  // date" would silently suppress the next check's result the same session.
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

  // Auto-dismiss transient outcomes of a user-initiated check after a delay.
  // Download progress and the "ready to install" banner stay until the user
  // explicitly dismisses or acts on them. Each check carries its own checkId,
  // so the next check's banner isn't suppressed by this auto-dismiss.
  useEffect(() => {
    if (status.kind === 'not-available' || (status.kind === 'error' && status.userInitiated)) {
      const key = statusKey
      const timer = window.setTimeout(() => setDismissedKey(key), TRANSIENT_DISMISS_MS)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [status, statusKey])

  // Decide whether this state should render at all. Background checks stay
  // silent for anything other than "available"; user-initiated checks always
  // surface feedback. Download + install states always show — once an update
  // is in-flight the user should be able to see and control it.
  const shouldShow = ((): boolean => {
    if (dismissedKey === statusKey) return false
    switch (status.kind) {
      case 'available':
      case 'downloading':
      case 'downloaded':
        return true
      case 'checking':
      case 'not-available':
        return status.userInitiated
      case 'error':
        return status.userInitiated
      case 'idle':
      default:
        return false
    }
  })()

  if (!shouldShow) return null

  const dismiss = (): void => setDismissedKey(statusKey)

  // --- Render per state --------------------------------------------------

  if (status.kind === 'available') {
    // With autoDownload enabled this state is usually transient — the updater
    // fires `download-progress` almost immediately and we move to
    // `downloading`. We still render a labelled "Preparing download…" so a
    // slow-to-start download doesn't look like nothing is happening.
    return (
      <BannerShell tone="primary">
        <span className="flex items-center gap-2 text-xs font-medium">
          <Loader2Icon className="size-3 animate-spin" />
          Preparing update v{status.version}…
        </span>
        <DismissButton tone="primary" onClick={dismiss} />
      </BannerShell>
    )
  }

  if (status.kind === 'downloading') {
    const percent = Math.max(0, Math.min(100, Math.round(status.percent)))
    return (
      <BannerShell tone="primary">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <DownloadIcon className="size-3" />
          <span className="shrink-0">Downloading update v{status.version}…</span>
          <ProgressBar percent={percent} />
          <span className="tabular-nums">{percent}%</span>
        </span>
        <DismissButton tone="primary" onClick={dismiss} />
      </BannerShell>
    )
  }

  if (status.kind === 'downloaded') {
    const restart = (): void => {
      void window.api.quitAndInstallUpdate()
    }
    return (
      <BannerShell tone="primary">
        <span className="flex items-center gap-2 text-xs font-medium">
          <CheckIcon className="size-3" />
          Update v{status.version} ready to install
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={restart}>
            <RotateCwIcon className="size-3" />
            Restart now
          </Button>
          <DismissButton tone="primary" onClick={dismiss} label="Install later" />
        </div>
      </BannerShell>
    )
  }

  if (status.kind === 'checking') {
    return (
      <BannerShell tone="muted">
        <span className="flex items-center gap-2 text-xs font-medium">
          <Loader2Icon className="size-3 animate-spin" />
          Checking for updates…
        </span>
      </BannerShell>
    )
  }

  if (status.kind === 'not-available') {
    return (
      <BannerShell tone="muted">
        <span className="flex items-center gap-2 text-xs font-medium">
          <CheckIcon className="size-3" />
          You&rsquo;re up to date (smarkup v{status.currentVersion})
        </span>
        <DismissButton tone="muted" onClick={dismiss} />
      </BannerShell>
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
      <BannerShell tone="destructive">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
          <AlertTriangleIcon className="size-3 shrink-0" />
          <span className="truncate">Couldn&rsquo;t install update: {status.message}</span>
        </span>
        <div className="flex items-center gap-1">
          {openRelease && (
            <Button
              size="sm"
              variant="secondary"
              className="h-6 px-2 text-xs"
              onClick={openRelease}
            >
              <ExternalLinkIcon className="size-3" />
              Download manually
            </Button>
          )}
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={retry}>
            Retry
          </Button>
          <DismissButton tone="destructive" onClick={dismiss} />
        </div>
      </BannerShell>
    )
  }

  return null
}

type Tone = 'primary' | 'muted' | 'destructive'

const TONE_CLASSES: Record<Tone, string> = {
  primary: 'bg-primary text-primary-foreground',
  muted: 'bg-muted text-foreground',
  destructive: 'bg-destructive text-destructive-foreground'
}

const BannerShell = ({
  tone,
  children
}: {
  tone: Tone
  children: React.ReactNode
}): React.JSX.Element => (
  <div
    className={`no-drag flex h-8 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-3 ${TONE_CLASSES[tone]}`}
    role="status"
    aria-live="polite"
  >
    {children}
  </div>
)

const DISMISS_TONE_CLASSES: Record<Tone, string> = {
  primary: 'text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground',
  muted: 'text-foreground hover:bg-foreground/10 hover:text-foreground',
  destructive:
    'text-destructive-foreground hover:bg-destructive-foreground/10 hover:text-destructive-foreground'
}

const DismissButton = ({
  tone,
  onClick,
  label = 'Dismiss'
}: {
  tone: Tone
  onClick: () => void
  label?: string
}): React.JSX.Element => (
  <Button
    size="icon"
    variant="ghost"
    className={`size-6 ${DISMISS_TONE_CLASSES[tone]}`}
    onClick={onClick}
    aria-label={label}
    title={label}
  >
    <XIcon className="size-3" />
  </Button>
)

// Slim inline progress indicator tinted against the primary banner. Stays
// narrow so the banner itself doesn't grow taller.
const ProgressBar = ({ percent }: { percent: number }): React.JSX.Element => (
  <span
    className="relative h-1 w-24 overflow-hidden rounded-full bg-primary-foreground/20"
    aria-hidden
  >
    <span
      className="absolute inset-y-0 left-0 bg-primary-foreground transition-[width] duration-200"
      style={{ width: `${percent}%` }}
    />
  </span>
)

export default UpdateBanner
