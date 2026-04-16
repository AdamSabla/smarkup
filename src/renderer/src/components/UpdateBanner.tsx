import { AlertTriangleIcon, CheckIcon, DownloadIcon, Loader2Icon, XIcon } from 'lucide-react'
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

  // Key a status by its kind plus any identifying payload. Two consecutive
  // "not-available" results from two separate clicks are the same key, which
  // is fine — if you just dismissed one, we don't need to re-pop the next.
  const statusKey =
    status.kind === 'available'
      ? `available:${status.version}`
      : status.kind === 'error'
        ? `error:${status.message}`
        : status.kind

  // Auto-dismiss transient outcomes of a user-initiated check after a delay.
  // "available" stays until the user explicitly dismisses or downloads.
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
  // surface feedback.
  const shouldShow = ((): boolean => {
    if (dismissedKey === statusKey) return false
    switch (status.kind) {
      case 'available':
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
    const handleDownload = (): void => {
      void window.api.openReleaseUrl(status.releaseUrl)
    }
    return (
      <BannerShell tone="primary">
        <span className="text-xs font-medium">Update available: smarkup v{status.version}</span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-xs"
            onClick={handleDownload}
          >
            <DownloadIcon className="size-3" />
            Download
          </Button>
          <DismissButton tone="primary" onClick={dismiss} />
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
    return (
      <BannerShell tone="destructive">
        <span className="flex items-center gap-2 text-xs font-medium">
          <AlertTriangleIcon className="size-3" />
          Couldn&rsquo;t check for updates: {status.message}
        </span>
        <div className="flex items-center gap-1">
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
  onClick
}: {
  tone: Tone
  onClick: () => void
}): React.JSX.Element => (
  <Button
    size="icon"
    variant="ghost"
    className={`size-6 ${DISMISS_TONE_CLASSES[tone]}`}
    onClick={onClick}
    aria-label="Dismiss"
  >
    <XIcon className="size-3" />
  </Button>
)

export default UpdateBanner
