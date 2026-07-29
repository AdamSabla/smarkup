import { useWorkspace, type SidebarSection, type FolderNode } from '@/store/workspace'

/**
 * `{{> path/to/partial}}` — the import form of a placeholder, the one that
 * always names another file.
 */
export const PARTIAL_RE = /\{\{>\s*([^}]+?)\s*\}\}/g

/** The referenced path inside an import span, or null if it isn't an import. */
export const partialRefOf = (span: string): string | null => {
  const m = /^\{\{>\s*([^}]+?)\s*\}\}$/.exec(span)
  // The visual editor's markdown escaping can leave backslashes in the span
  // (`\_shared/…`); they're not part of the path.
  return m ? m[1].replace(/\\/g, '') : null
}

/**
 * A plain `{{name}}` placeholder's contents, when they could plausibly be a
 * path: word characters, dashes, dots and slashes only. Template syntax like
 * `{{#if x}}` or `{{a b}}` names no file and is left alone.
 */
const plainRefOf = (span: string): string | null => {
  const m = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(span)
  if (!m) return null
  const ref = m[1].replace(/\\/g, '')
  return /^[\w.-]+(?:[/\\][\w.-]+)*$/.test(ref) ? ref : null
}

const SEP_RE = /[/\\]/

const dirOf = (path: string): string => {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at > 0 ? path.slice(0, at) : ''
}

const join = (base: string, rest: string): string =>
  `${base}${base.includes('\\') && !base.includes('/') ? '\\' : '/'}${rest}`

/** How far up from the referencing file we'll look for the reference's root. */
const MAX_ASCENT = 8

/**
 * Absolute paths a reference could mean, most likely first.
 *
 * The file beside you wins, then its parent, and so on: `{{revision}}` next to
 * a `revision.md` is that file, while a reference like
 * `_shared/market-conventions` is written relative to the *tree* it lives in
 * and resolves from any depth. Sidebar roots come last, for files opened from
 * outside the tree.
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

/* ------------------------------------------------------------------ */
/*  Synchronous file index                                             */
/* ------------------------------------------------------------------ */

let indexed: SidebarSection[] | null = null
let index = new Set<string>()

const collect = (node: FolderNode | SidebarSection, into: Set<string>): void => {
  for (const f of node.files) into.add(f.path)
  for (const sub of node.subfolders) collect(sub, into)
}

/**
 * Every markdown file the sidebar knows about, as a set of paths.
 *
 * Decorations are built synchronously — asking the filesystem per placeholder
 * on every keystroke isn't an option — and the sidebar has already walked the
 * same folders, so the answer is sitting in the store. Rebuilt only when the
 * section list is replaced, which is what a refresh does.
 */
const fileIndex = (): Set<string> => {
  const { sections } = useWorkspace.getState()
  if (sections !== indexed) {
    const next = new Set<string>()
    for (const section of sections) collect(section, next)
    index = next
    indexed = sections
  }
  return index
}

/** The path a tab is showing — what its placeholders resolve against. */
export const pathOfTab = (tabId: string): string =>
  useWorkspace.getState().tabs.find((t) => t.id === tabId)?.path ?? ''

/** The file a reference names, decided from the index alone. */
export const resolveRefSync = (ref: string, fromPath: string): string | null => {
  const { sections, draftsFolder } = useWorkspace.getState()
  const roots = [...sections.map((s) => s.path ?? ''), draftsFolder ?? '']
  const files = fileIndex()
  for (const path of candidatePaths(ref, fromPath, roots)) {
    if (files.has(path)) return path
  }
  return null
}

/**
 * What a placeholder links to, if anything.
 *
 * An import (`{{> x}}`) is a file reference by definition, so it stays
 * clickable even when nothing matches — clicking then says what's missing,
 * which is more useful than a dead placeholder. A plain `{{name}}` is only a
 * link when a file by that name actually exists next to it (or above it):
 * every other placeholder is a substitution, and decorating those would put an
 * open icon on half the document.
 */
export const linkTargetOf = (
  span: string,
  fromPath: string
): { ref: string; path: string | null } | null => {
  const importRef = partialRefOf(span)
  if (importRef) return { ref: importRef, path: resolveRefSync(importRef, fromPath) }
  const ref = plainRefOf(span)
  if (!ref) return null
  const path = resolveRefSync(ref, fromPath)
  return path ? { ref, path } : null
}

/**
 * Locate the file a reference points at, falling back to the filesystem when
 * the index doesn't know it — a file created outside the app is on disk before
 * the sidebar hears about it.
 */
export const resolveRef = async (ref: string, fromPath: string): Promise<string | null> => {
  const fromIndex = resolveRefSync(ref, fromPath)
  if (fromIndex) return fromIndex
  const { sections, draftsFolder } = useWorkspace.getState()
  const roots = [...sections.map((s) => s.path ?? ''), draftsFolder ?? '']
  const paths = candidatePaths(ref, fromPath, roots)
  if (paths.length === 0) return null
  const hits = await Promise.all(paths.map((p) => window.api.pathExists(p).catch(() => false)))
  const at = hits.indexOf(true)
  return at >= 0 ? paths[at] : null
}

/**
 * Open the file a placeholder references, in a tab.
 *
 * `path` is what the decoration already resolved; it's re-resolved only when
 * the decoration couldn't. A reference that resolves to nothing says so rather
 * than failing silently — a typo in the path and a file that hasn't been
 * created yet look identical from here.
 */
export const openPartial = async (ref: string, path?: string): Promise<void> => {
  const { activeTabId, tabs, openFile, showToast } = useWorkspace.getState()
  const fromPath = (activeTabId ? tabs.find((t) => t.id === activeTabId)?.path : '') ?? ''
  const target = path || (await resolveRef(ref, fromPath))
  if (!target) {
    showToast(`Can't find “${ref}” — no matching file in the open folders`, 'error')
    return
  }
  await openFile(target)
}
