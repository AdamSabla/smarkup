import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronUpIcon, ChevronDownIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/store/workspace'
import { useActiveEditor } from '@/lib/active-editor'
import { useActiveRawEditor } from '@/lib/active-raw-editor'
import {
  createCMSearchAdapter,
  createTiptapSearchAdapter,
  type MatchInfo,
  type SearchAdapter
} from '@/lib/search-adapter'

/**
 * Chrome-style minimal find/replace bar. Floats top-right inside the active
 * EditorPane.
 *
 * Two rows: query (with match counter + prev/next/close) and replace (with
 * replace + replace-all). Both rows stay visible whenever the bar is open —
 * no chevron, no settings.
 *
 * Driven by an editor-agnostic `SearchAdapter` that is rebuilt whenever the
 * active editor swaps (tab switch, visual ↔ raw toggle). When the bar opens
 * with a previous query still in state, it re-runs the query against the new
 * editor so the user picks up where they left off.
 */
const FindBar = (): React.JSX.Element | null => {
  const open = useWorkspace((s) => s.findBarOpen)
  const close = useWorkspace((s) => s.closeFindBar)
  const rawView = useActiveRawEditor()
  const visualEditor = useActiveEditor()

  // Build an adapter for whichever editor is currently focused. The visual
  // editor wins ties (only one should be non-null at a time, but be defensive).
  const adapter: SearchAdapter | null = useMemo(() => {
    if (visualEditor) return createTiptapSearchAdapter(visualEditor)
    if (rawView) return createCMSearchAdapter(rawView)
    return null
  }, [visualEditor, rawView])

  // Query / replacement strings persist across open→close so reopening with
  // ⌘F prefills the last query (same as Chrome). Match info is recomputed
  // every time setQuery/next/prev runs.
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [info, setInfo] = useState<MatchInfo>({ count: 0, current: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  // Search trigger lives on the input's onChange (see `runSearch` below) —
  // calling setState in an event handler is the React-recommended pattern,
  // versus running the search in an effect which would trip
  // `react-hooks/set-state-in-effect`. We also keep `queryRef` in sync here
  // so the adapter-swap effect below can re-apply the latest query without
  // listing `query` in its deps (which would re-run on every keystroke).
  const queryRef = useRef('')
  const runSearch = useCallback(
    (q: string): void => {
      queryRef.current = q
      setQuery(q)
      if (adapter) setInfo(adapter.setQuery(q))
    },
    [adapter]
  )

  // When the active editor swaps (tab switch, raw↔visual toggle), re-apply
  // the persisted query against the new adapter so highlights survive the
  // swap, and clean them up when this adapter goes away.
  useEffect(() => {
    if (!adapter) return
    // Defer the setInfo to a microtask so we don't call setState
    // synchronously inside an effect (react-hooks/set-state-in-effect). The
    // microtask flushes before paint, so the counter still reflects the
    // re-applied query in the same frame.
    const result = adapter.setQuery(queryRef.current)
    queueMicrotask(() => setInfo(result))
    return () => adapter.clear()
  }, [adapter])

  // When the bar opens, focus + select the existing query so the user can
  // immediately start typing to overwrite it (Chrome behavior).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  // ⌘F while the bar is open re-focuses + re-selects (Chrome behavior). The
  // global ⌘F handler in useShortcuts handles this by always calling
  // openFindBar — but if the bar is already open, the open prop doesn't
  // change and the focus effect above doesn't re-run. Listen for the
  // shortcut here too so reopen-while-open still re-focuses.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      const isMac = navigator.userAgent.toLowerCase().includes('mac')
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.key.toLowerCase() === 'f' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const next = useCallback(() => {
    if (!adapter) return
    setInfo(adapter.next())
  }, [adapter])

  const prev = useCallback(() => {
    if (!adapter) return
    setInfo(adapter.prev())
  }, [adapter])

  const doReplace = useCallback(() => {
    if (!adapter) return
    setInfo(adapter.replace(replacement))
  }, [adapter, replacement])

  const doReplaceAll = useCallback(() => {
    if (!adapter) return
    adapter.replaceAll(replacement)
    // After replaceAll, no matches remain for the same query (unless the
    // replacement string itself contains the query). Re-run setQuery to
    // surface the new state.
    setInfo(adapter.setQuery(query))
  }, [adapter, query, replacement])

  const onQueryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.shiftKey ? prev() : next()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const onReplaceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doReplace()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  if (!open) return null

  const counterText = query
    ? info.count === 0
      ? 'No results'
      : `${info.current || 1} of ${info.count}`
    : ''
  const hasNoMatch = Boolean(query) && info.count === 0

  return (
    <div
      className={cn(
        'absolute right-3 top-3 z-20 flex flex-col gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-lg',
        'min-w-[360px] text-sm'
      )}
      // Stop mousedown from bubbling to EditorPane's handler, which would
      // re-set the active pane and yank focus back into the editor.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Find row */}
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          placeholder="Find"
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          onKeyDown={onQueryKeyDown}
          className={cn(
            'h-7 flex-1 min-w-0 rounded-md border bg-background px-2 text-sm outline-none',
            'placeholder:text-muted-foreground focus:ring-1 focus:ring-ring',
            hasNoMatch ? 'border-destructive/60 focus:ring-destructive/60' : 'border-input'
          )}
        />
        <span
          className={cn(
            'min-w-[64px] px-1 text-right text-[11px] tabular-nums',
            hasNoMatch ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {counterText}
        </span>
        <IconButton onClick={prev} title="Previous match (Shift+Enter)" disabled={info.count === 0}>
          <ChevronUpIcon className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={next} title="Next match (Enter)" disabled={info.count === 0}>
          <ChevronDownIcon className="h-4 w-4" />
        </IconButton>
        <IconButton onClick={close} title="Close (Esc)">
          <XIcon className="h-4 w-4" />
        </IconButton>
      </div>

      {/* Replace row */}
      <div className="flex items-center gap-1">
        <input
          type="text"
          placeholder="Replace"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={onReplaceKeyDown}
          className={cn(
            'h-7 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none',
            'placeholder:text-muted-foreground focus:ring-1 focus:ring-ring'
          )}
        />
        {/* Reserve the same width as the counter above so the buttons in both
         *  rows align vertically. */}
        <span className="min-w-[64px]" aria-hidden />
        <TextButton onClick={doReplace} disabled={info.count === 0}>
          Replace
        </TextButton>
        <TextButton onClick={doReplaceAll} disabled={info.count === 0}>
          All
        </TextButton>
      </div>
    </div>
  )
}

const IconButton = ({
  children,
  onClick,
  title,
  disabled
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  disabled?: boolean
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    disabled={disabled}
    className={cn(
      'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground',
      'hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent'
    )}
  >
    {children}
  </button>
)

const TextButton = ({
  children,
  onClick,
  disabled
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'inline-flex h-7 items-center justify-center rounded-md px-2 text-xs font-medium text-muted-foreground',
      'hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent'
    )}
  >
    {children}
  </button>
)

export default FindBar
