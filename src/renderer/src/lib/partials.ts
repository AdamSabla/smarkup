import { useWorkspace } from '@/store/workspace'

/**
 * `{{> path/to/partial}}` — the import form of a placeholder, the one that
 * names another file. Plain `{{variable}}` substitutions don't, so they aren't
 * matched here.
 */
export const PARTIAL_RE = /\{\{>\s*([^}]+?)\s*\}\}/g

/** The referenced path inside a placeholder span, or null if it isn't an import. */
export const partialRefOf = (span: string): string | null => {
  const m = /^\{\{>\s*([^}]+?)\s*\}\}$/.exec(span)
  // The visual editor's markdown escaping can leave backslashes in the span
  // (`\_shared/…`); they're not part of the path.
  return m ? m[1].replace(/\\/g, '') : null
}

const SEP_RE = /[/\\]/

const dirOf = (path: string): string => {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at > 0 ? path.slice(0, at) : ''
}

const join = (base: string, rest: string): string =>
  `${base}${base.includes('\\') && !base.includes('/') ? '\\' : '/'}${rest}`

/** How far up from the referencing file we'll look for the partial's root. */
const MAX_ASCENT = 8

/**
 * Absolute paths a reference could mean, most likely first.
 *
 * A reference like `_shared/market-conventions` is written relative to the
 * *tree* it lives in, not to the file quoting it — the same string resolves
 * from any depth of the prompt folder. So we walk up from the file, then try
 * the sidebar's roots, and take the first candidate that exists on disk.
 */
const candidatePaths = (ref: string, fromPath: string, roots: string[]): string[] => {
  const clean = ref
    .replace(/^\.\//, '')
    .replace(/^[/\\]+/, '')
    .replace(/[/\\]+$/, '')
  if (!clean) return []
  const bases: string[] = []
  let dir = dirOf(fromPath)
  for (let i = 0; i < MAX_ASCENT && dir; i++) {
    bases.push(dir)
    const parent = dirOf(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const root of roots) if (root) bases.push(root)

  const out: string[] = []
  for (const base of bases) {
    for (const name of clean.endsWith('.md') ? [clean] : [`${clean}.md`, clean]) {
      const path = join(base, name.split(SEP_RE).join(base.includes('\\') ? '\\' : '/'))
      if (!out.includes(path)) out.push(path)
    }
  }
  return out
}

/**
 * Locate the file a `{{> ref}}` import points at, or null if nothing matches.
 * Candidates are probed in parallel and the most specific hit wins, so a
 * `_shared` beside the file beats one at the top of the workspace.
 */
export const resolvePartial = async (ref: string, fromPath: string): Promise<string | null> => {
  const { sections, draftsFolder } = useWorkspace.getState()
  const roots = [...sections.map((s) => s.path ?? ''), draftsFolder ?? '']
  const paths = candidatePaths(ref, fromPath, roots)
  if (paths.length === 0) return null
  const hits = await Promise.all(paths.map((p) => window.api.pathExists(p).catch(() => false)))
  const at = hits.indexOf(true)
  return at >= 0 ? paths[at] : null
}

/**
 * Open the file a partial import references, in a tab.
 *
 * Called from both editors' placeholder decorations. A reference that doesn't
 * resolve says so rather than failing silently — a typo in the path and a file
 * that hasn't been created yet look identical from here.
 */
export const openPartial = async (ref: string): Promise<void> => {
  const { activeTabId, tabs, openFile, showToast } = useWorkspace.getState()
  const fromPath = (activeTabId ? tabs.find((t) => t.id === activeTabId)?.path : '') ?? ''
  const path = await resolvePartial(ref, fromPath)
  if (!path) {
    showToast(`Can't find “${ref}” — no matching file in the open folders`, 'error')
    return
  }
  await openFile(path)
}
