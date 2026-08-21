import { useEffect, useState } from 'react'
import { MinusIcon, PlusIcon, RotateCcwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import Spinner from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { MermaidError, renderMermaid } from '@/lib/mermaid'
import { useWorkspace } from '@/store/workspace'

/** Zoom stops, in the order the − / + buttons walk through them. */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
/** Index of 1× — where stepping away from "fit" starts counting. */
const NATURAL = 2
/**
 * Zoom is either a stop in `ZOOM_STEPS` or `null`, meaning "fit": the diagram
 * scaled down to whatever width the dialog has, which is how every preview
 * opens. Fit is a CSS rule rather than a number (see `.smarkup-mermaid.is-fit`),
 * so it needs no measuring and survives the window being resized underneath it.
 */
type Zoom = number | null

type Outcome = { status: 'ready'; svg: string } | { status: 'error'; message: string }
type View = Outcome | { status: 'loading' }

const EMPTY: Outcome = { status: 'error', message: 'This code block is empty.' }

/**
 * Tracks the `dark` class that `useTheme` writes onto `<html>`.
 *
 * Watching the class rather than the store's `theme` is deliberate: `theme`
 * can be `system`, and the OS flipping to dark under an open preview has to
 * repaint the diagram too. The class is the one value that is true either way.
 */
const useIsDark = (): boolean => {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setIsDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

/**
 * The rendered form of a ```mermaid fence, opened from the diagram button in
 * the corner of the block (see extensions/code-block-actions.ts).
 *
 * Read-only on purpose. The document is the source of truth for the diagram
 * and the editor is right behind this dialog, so an editable copy here would
 * only raise the question of which one wins. What the preview owes you is the
 * picture, the reason it isn't a picture yet when the syntax is off, and
 * enough zoom to read a diagram that outgrew the window.
 *
 * Both bits of state below are stamped with the preview they belong to and
 * read back by comparison, rather than being reset from an effect. Rendering
 * is async and the theme can change halfway through it, so "which request is
 * this answer for" has to be part of the answer — and once it is, a result
 * that doesn't match the question on screen simply reads as still loading.
 */
const MermaidPreviewDialog = (): React.JSX.Element => {
  const preview = useWorkspace((s) => s.mermaidPreview)
  const close = useWorkspace((s) => s.closeMermaidPreview)
  const isDark = useIsDark()

  /** The last finished render, and the open + theme it was produced for. */
  const [result, setResult] = useState<{
    for: object
    isDark: boolean
    outcome: Outcome
  } | null>(null)
  /** Zoom belongs to the sitting: keyed on the open, so it survives a theme
   *  flip mid-read but starts fresh the next time the block is opened. */
  const [zoomState, setZoomState] = useState<{ for: object; zoom: Zoom } | null>(null)

  const code = preview?.code ?? ''
  const blank = code.trim().length === 0

  const view: View = !preview
    ? { status: 'loading' }
    : blank
      ? EMPTY
      : result?.for === preview && result.isDark === isDark
        ? result.outcome
        : { status: 'loading' }

  const zoom: Zoom = preview && zoomState?.for === preview ? zoomState.zoom : null
  const setZoom = (next: Zoom): void => {
    if (preview) setZoomState({ for: preview, zoom: next })
  }
  // Stepping out of fit lands on a stop either side of 1×, so the first press
  // of + always magnifies and the first press of − always shrinks.
  const index = zoom === null ? NATURAL : ZOOM_STEPS.indexOf(zoom)
  const stepZoom = (delta: number): void =>
    setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + delta))])
  const atMin = zoom !== null && index === 0
  const atMax = zoom !== null && index === ZOOM_STEPS.length - 1

  // Runs on open and again whenever the theme changes under an open preview —
  // mermaid bakes its palette into the SVG, so a flip needs a fresh render.
  useEffect(() => {
    if (!preview || blank) return
    let cancelled = false
    renderMermaid(preview.code, isDark)
      .then((svg) => {
        if (!cancelled) setResult({ for: preview, isDark, outcome: { status: 'ready', svg } })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setResult({
          for: preview,
          isDark,
          outcome: {
            status: 'error',
            message:
              error instanceof MermaidError
                ? error.message
                : "The diagram library couldn't be loaded."
          }
        })
      })
    return () => {
      cancelled = true
    }
  }, [preview, blank, isDark])

  return (
    <Dialog open={preview != null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        // The diagram is the content — nothing in here wants the caret, and
        // focusing a zoom button on open would put it under the arrow keys.
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Deliberately near-fullscreen, and wider than the usual dialog cap:
        // every pixel of width is another node the "fit" scale doesn't have to
        // shrink away, and a diagram is the one kind of content where reading
        // it at all depends on how much of it fits at once. The margin left is
        // just enough to keep the window behind it visible as context.
        className="flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] w-[calc(100vw-3rem)] flex-col gap-3 overflow-hidden sm:max-w-[calc(100vw-3rem)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4">
          <div>
            <DialogTitle className="pr-0 text-base">Diagram</DialogTitle>
            <DialogDescription className="text-xs">
              Rendered with Mermaid · read-only
            </DialogDescription>
          </div>
          {view.status === 'ready' && (
            // `mr-8` keeps the cluster clear of the dialog's own close button.
            <div className="mr-8 flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Zoom out"
                title="Zoom out"
                disabled={atMin}
                onClick={() => stepZoom(-1)}
              >
                <MinusIcon className="size-4" />
              </Button>
              <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
                {zoom === null ? 'Fit' : `${Math.round(zoom * 100)}%`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Zoom in"
                title="Zoom in"
                disabled={atMax}
                onClick={() => stepZoom(1)}
              >
                <PlusIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Fit to window"
                title="Fit to window"
                disabled={zoom === null}
                onClick={() => setZoom(null)}
              >
                <RotateCcwIcon className="size-4" />
              </Button>
            </div>
          )}
        </div>

        {view.status === 'loading' && (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        )}

        {view.status === 'error' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <p className="shrink-0 text-sm text-destructive">{view.message}</p>
            {!blank && (
              // The source, so the line the parser is complaining about is in
              // front of you rather than behind the dialog.
              <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre">
                {code}
              </pre>
            )}
          </div>
        )}

        {view.status === 'ready' && (
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card p-4">
            {/* `zoom` rather than a transform: it reflows the scroll container,
                so a magnified diagram can actually be scrolled to its edges. */}
            <div
              className={cn('smarkup-mermaid w-fit min-w-full', zoom === null && 'is-fit')}
              style={zoom === null ? undefined : { zoom }}
              // Mermaid runs its output through DOMPurify at securityLevel
              // 'strict' — see lib/mermaid.ts.
              dangerouslySetInnerHTML={{ __html: view.svg }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default MermaidPreviewDialog
