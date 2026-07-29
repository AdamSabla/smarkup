import { useEffect, useState } from 'react'
import { useActiveEditor } from '@/lib/active-editor'
import { useActiveRawEditor } from '@/lib/active-raw-editor'

/** How far below the top of the viewport a heading still counts as "above". */
const TOP_BAND = 8

/**
 * Index of the section the editor is currently parked in, or `null` when the
 * viewport is still up in the preamble.
 *
 * Both editors answer the same question in their own terms: the visual editor
 * by measuring its top-level heading elements (whose order matches the
 * outline's, since both count only headings at the top of the document), the
 * raw one by asking CodeMirror which source position sits at the top of the
 * viewport and comparing it against the sections' offsets.
 *
 * `offsets` must describe the content as it currently is — pass
 * `sectionOffsets(parseOutline(content))`.
 */
export const useActiveHeading = (offsets: number[], enabled: boolean): number | null => {
  const visual = useActiveEditor()
  const raw = useActiveRawEditor()
  const [index, setIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    const scroller = visual
      ? (visual.view.dom.closest('.overflow-auto') as HTMLElement | null)
      : (raw?.scrollDOM ?? null)
    if (!scroller) return

    const measure = (): number | null => {
      if (visual && !visual.isDestroyed) {
        const top = scroller.getBoundingClientRect().top + TOP_BAND
        const headings = Array.from(visual.view.dom.children).filter((el) =>
          /^H[1-6]$/.test(el.tagName)
        )
        let found: number | null = null
        headings.forEach((el, i) => {
          if (el.getBoundingClientRect().top <= top) found = i
        })
        return found
      }
      if (raw) {
        const box = raw.scrollDOM.getBoundingClientRect()
        const pos = raw.posAtCoords({ x: box.left + 8, y: box.top + TOP_BAND }, false)
        let found: number | null = null
        offsets.forEach((offset, i) => {
          if (offset <= pos) found = i
        })
        return found
      }
      return null
    }

    let frame = 0
    const update = (): void => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const next = measure()
        setIndex((prev) => (prev === next ? prev : next))
      })
    }

    update()
    scroller.addEventListener('scroll', update, { passive: true })
    // The editor can move the caret without scrolling (⌘PageDown, a jump from
    // the outline itself), and content edits reflow everything below them.
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      scroller.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [visual, raw, enabled, offsets])

  // Reported rather than cleared on disable: the last measurement is only
  // meaningful while we're tracking, and resetting it from the effect body
  // would just cost an extra render.
  return enabled ? index : null
}
