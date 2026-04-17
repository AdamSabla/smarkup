import type { DiffResult } from '@/lib/diff-engine'

type Props = {
  diff: DiffResult
  onPrev: () => void
  onNext: () => void
  onSwap: () => void
  onClose: () => void
}

const DiffStatusBar = ({ diff, onPrev, onNext, onSwap, onClose }: Props): React.JSX.Element => {
  const parts: string[] = []
  if (diff.additions > 0) parts.push(`${diff.additions} added`)
  if (diff.deletions > 0) parts.push(`${diff.deletions} removed`)
  if (diff.changes > 0) parts.push(`${diff.changes} changed`)
  const summary = parts.length > 0 ? parts.join(', ') : 'No differences'

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border bg-background px-3 text-xs text-muted-foreground">
      <span>{summary}</span>

      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onPrev}
          className="rounded px-1.5 py-0.5 hover:bg-muted"
          title="Previous difference"
        >
          ▲ Prev
        </button>
        <button
          onClick={onNext}
          className="rounded px-1.5 py-0.5 hover:bg-muted"
          title="Next difference"
        >
          ▼ Next
        </button>

        <span className="mx-1 h-3 w-px bg-border" />

        <button
          onClick={onSwap}
          className="rounded px-1.5 py-0.5 hover:bg-muted"
          title="Swap sides"
        >
          ⇄ Swap
        </button>

        <button
          onClick={onClose}
          className="rounded px-1.5 py-0.5 hover:bg-muted"
          title="Close diff view"
        >
          ✕ Close
        </button>
      </div>
    </div>
  )
}

export default DiffStatusBar
