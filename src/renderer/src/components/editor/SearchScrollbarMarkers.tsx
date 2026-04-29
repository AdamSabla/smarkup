import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { SearchAdapter } from '@/lib/search-adapter'

/**
 * Chrome-style scrollbar gutter that paints a yellow tick at the vertical
 * position of every search match plus an orange tick for the current one.
 *
 * Sits as an absolute overlay on the right edge of the editor pane. Picks up
 * positions from the `SearchAdapter` (which knows how to talk to either the
 * CodeMirror or Tiptap editor) and re-polls on each animation frame so the
 * ticks stay accurate as the user types, replaces, or resizes the window.
 *
 * The poll bails out via shallow comparison if positions haven't shifted, so
 * it's effectively idle when the document isn't changing.
 */
type Props = {
  adapter: SearchAdapter | null
  /** Bumped whenever the FindBar runs a query/next/prev/replace — kicks the
   *  effect to re-subscribe (in case the adapter swapped). */
  trigger: number
  /** Total match count from the FindBar; if 0, the gutter renders nothing. */
  count: number
}

const SearchScrollbarMarkers = ({ adapter, trigger, count }: Props): React.JSX.Element | null => {
  const [positions, setPositions] = useState<{ fractions: number[]; current: number }>({
    fractions: [],
    current: -1
  })

  useEffect(() => {
    if (!adapter || count === 0) return
    let raf = 0
    const tick = (): void => {
      const next = adapter.getMatchPositions()
      setPositions((prev) => {
        if (
          prev.current === next.current &&
          prev.fractions.length === next.fractions.length &&
          prev.fractions.every((v, i) => v === next.fractions[i])
        ) {
          return prev
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [adapter, count, trigger])

  // Render guard covers two cases: (a) count just dropped to zero — the rAF
  // loop is unsubscribed so `positions` may still hold stale fractions; we
  // hide them; (b) initial render before the first frame has fired.
  if (count === 0 || positions.fractions.length === 0) return null

  return (
    <div className="smarkup-search-gutter" aria-hidden>
      {positions.fractions.map((frac, i) => {
        const isCurrent = i === positions.current
        return (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            onClick={() => adapter?.scrollToMatch(i)}
            className={cn(
              'smarkup-search-gutter-tick',
              isCurrent && 'smarkup-search-gutter-tick-current'
            )}
            style={{ top: `calc(${frac * 100}% - 2px)` }}
            title={`Match ${i + 1} of ${positions.fractions.length}`}
          />
        )
      })}
    </div>
  )
}

export default SearchScrollbarMarkers
