/**
 * Mermaid rendering, kept behind a lazy import.
 *
 * Mermaid is by far the largest thing in this app's dependency tree — the
 * library plus the diagram grammars it loads on demand roughly doubles the
 * renderer bundle. Almost no session opens a diagram, so it is imported the
 * first time someone actually asks for a preview rather than at startup. The
 * import promise is cached, so the cost is paid once per window.
 *
 * Everything here runs in the renderer against the real DOM: mermaid measures
 * text by laying it out in a throwaway element, so there is no rendering this
 * off in the main process or in a worker.
 */

/** The `mermaid` default export, resolved on first use and reused after. */
let loading: Promise<typeof import('mermaid').default> | null = null

const load = (): Promise<typeof import('mermaid').default> => {
  loading ??= import('mermaid').then((m) => m.default)
  return loading
}

/** Ids handed to `mermaid.render`, which requires a fresh one per call. */
let counter = 0

/**
 * The languages a fenced block can be tagged with to mean "this is mermaid".
 * `mmd` is the extension mermaid's own CLI uses, and shows up in the wild.
 */
const LANGUAGES = new Set(['mermaid', 'mmd'])

export const isMermaidLanguage = (language: string | null | undefined): boolean =>
  !!language && LANGUAGES.has(language.trim().toLowerCase())

/**
 * Mermaid reports syntax errors as a plain `Error` most of the time and as its
 * own `DetailedError` (a `.str` plus parser state) for grammar failures. Take
 * whichever message is present and leave the parser's stack trace out of it —
 * the dialog shows this to someone who wants to know which line is wrong.
 */
const messageOf = (error: unknown): string => {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const detailed = error as { str?: unknown; message?: unknown }
    if (typeof detailed.str === 'string' && detailed.str) return detailed.str
    if (typeof detailed.message === 'string' && detailed.message) return detailed.message
  }
  return 'This diagram could not be rendered.'
}

export class MermaidError extends Error {}

/** The face mermaid is configured to draw labels in, below. */
const LABEL_FONT = '16px Inter'

/**
 * Replace mermaid's elastic sizing with the diagram's real one.
 *
 * Mermaid emits `width="100%"` and a pixel `max-width`, so the diagram fits
 * whatever box it lands in. That's the right default for a page that just
 * shows a chart, and the wrong one for a viewer: 100% of a container the
 * browser has scaled is still the same number of screen pixels, so zooming
 * does nothing at all. The true size is in the viewBox — pin the SVG to it and
 * let the dialog decide between fitting it and letting it overflow.
 *
 * Parsed as HTML rather than XML on purpose: mermaid puts HTML labels inside
 * `<foreignObject>`, which is not guaranteed to be well-formed XML, and the
 * strict parser turns one stray tag into a parse-error document.
 */
const withIntrinsicSize = (markup: string): string => {
  const svg = new DOMParser().parseFromString(markup, 'text/html').querySelector('svg')
  if (!svg) return markup

  const [, , width, height] = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return markup
  }

  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.style.removeProperty('max-width')
  return svg.outerHTML
}

/**
 * Wait for the label font before measuring anything.
 *
 * Mermaid sizes every box by measuring its label first and drawing the box
 * around the result. If the font swaps in between those two steps the boxes
 * are already a few pixels too narrow, and every label in the diagram renders
 * visibly clipped — which is exactly what happens on the first preview of a
 * cold start, while Inter is still in flight and measurement falls back to
 * system metrics. `fonts.ready` alone isn't enough: it only waits for loads
 * already in flight, so ask for the face first.
 */
const fontReady = async (): Promise<void> => {
  try {
    await document.fonts.load(LABEL_FONT)
    await document.fonts.ready
  } catch {
    // Best-effort — a diagram measured against fallback metrics still beats
    // no diagram at all.
  }
}

/**
 * Render mermaid source to an SVG string.
 *
 * Throws `MermaidError` with a readable message when the source doesn't parse.
 *
 * @param code   the fenced block's contents, verbatim
 * @param isDark whether the app is on the dark theme right now
 */
export const renderMermaid = async (code: string, isDark: boolean): Promise<string> => {
  const [mermaid] = await Promise.all([load(), fontReady()])

  // Re-initialised per render because the theme can change under an open
  // preview, and `initialize` is mermaid's only way to switch it.
  mermaid.initialize({
    startOnLoad: false,
    // 'strict' runs the output through DOMPurify and drops click bindings, so
    // the SVG can be dropped into the dialog with innerHTML. Diagram source
    // arrives from whatever markdown file was opened, which is not necessarily
    // something the person reading it wrote.
    securityLevel: 'strict',
    theme: isDark ? 'dark' : 'default',
    // Mermaid's default is Trebuchet; match the app so a diagram doesn't read
    // as a screenshot pasted in from somewhere else. Kept in step with
    // LABEL_FONT above, which is what gets waited on.
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
  })

  const id = `smarkup-mermaid-${++counter}`
  try {
    const { svg } = await mermaid.render(id, code)
    return withIntrinsicSize(svg)
  } catch (error) {
    throw new MermaidError(messageOf(error))
  } finally {
    // Mermaid measures in a detached-ish container (`d<id>`) parented to the
    // body and tidies it up on success — but not on every failure path. Left
    // alone, a run of bad diagrams quietly grows the document.
    document.getElementById(`d${id}`)?.remove()
    document.getElementById(id)?.remove()
  }
}
