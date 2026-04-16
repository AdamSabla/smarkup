import { useEffect } from 'react'
import { XIcon, AlertCircleIcon, InfoIcon } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'
import { cn } from '@/lib/utils'

const AUTO_DISMISS_MS = 3500

/**
 * Bottom-of-window transient notice. Shown by `useWorkspace.showToast(msg)`;
 * auto-dismisses after a few seconds. A fresh toast `id` resets the timer,
 * so re-triggering the same kind of event doesn't stack messages.
 */
const Toast = (): React.JSX.Element | null => {
  const toast = useWorkspace((s) => s.toast)
  const dismiss = useWorkspace((s) => s.dismissToast)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => {
      dismiss()
    }, AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
    // Each new toast gets a fresh object reference (and a new id inside it),
    // so depending on `toast` restarts the timer exactly when we want.
  }, [toast, dismiss])

  if (!toast) return null

  const Icon = toast.kind === 'error' ? AlertCircleIcon : InfoIcon

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center"
    >
      <div
        className={cn(
          'pointer-events-auto flex max-w-md items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-lg',
          'bg-background/95 backdrop-blur-sm',
          toast.kind === 'error' ? 'border-destructive/50 text-destructive' : 'border-border'
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">{toast.message}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export default Toast
