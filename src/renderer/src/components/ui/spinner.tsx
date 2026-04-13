import { cn } from '@/lib/utils'

/**
 * Minimal, unobtrusive spinner used as a fallback inside dialogs while
 * async data is being fetched. Rendered inline — callers are responsible
 * for positioning / framing it.
 */
const Spinner = ({ className }: { className?: string }): React.JSX.Element => (
  <div
    role="status"
    aria-label="Loading"
    className={cn(
      'size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground',
      className
    )}
  />
)

export default Spinner
