/**
 * Turn a markdown document into a candidate filename.
 *
 * Used by the auto-name-from-first-line feature: drafts created via "New
 * draft" keep their filename in sync with their first non-empty line until
 * the user explicitly renames the file.
 *
 * Returns `null` when no usable name can be derived (all lines are empty
 * or pure syntax). The caller should leave the filename alone in that case.
 */

const MAX_LEN = 60

// Characters that can't appear in macOS / Linux / Windows filenames, plus
// control chars. Replaced with a space; we collapse runs of whitespace at
// the end. Backslash and forward-slash matter most because they'd silently
// reroute the rename into a different directory.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\u0000-\u001f\u007f<>:"/\\|?*]/g

const stripInlineMarkdown = (s: string): string => {
  let out = s
  // Images first (before links — they share the [...](...) suffix).
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  // Links → just the visible text.
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  // Reference-style links: [text][ref] → text
  out = out.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
  // Bold/italic — order matters: 3-char (***x***), then 2-char, then 1-char.
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
  out = out.replace(/___([^_]+)___/g, '$1')
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1')
  out = out.replace(/__([^_]+)__/g, '$1')
  out = out.replace(/\*([^*]+)\*/g, '$1')
  out = out.replace(/_([^_]+)_/g, '$1')
  // Inline code.
  out = out.replace(/`([^`]+)`/g, '$1')
  // Strikethrough.
  out = out.replace(/~~([^~]+)~~/g, '$1')
  return out
}

const stripLinePrefix = (line: string): string => {
  // Strip leading prefixes one at a time, in order, until none match.
  // Order matters: task-list bullet (`- [ ]`) must come before plain bullet.
  let s = line
  // Block quote markers: `> ` (possibly nested: `> > `).
  while (/^>\s*/.test(s)) s = s.replace(/^>\s*/, '')
  // ATX heading: `#`, `##`, … up to 6.
  s = s.replace(/^#{1,6}\s+/, '')
  // Task-list bullet: `- [ ]` or `- [x]`.
  s = s.replace(/^[-*+]\s+\[[ xX]\]\s+/, '')
  // Plain bullet.
  s = s.replace(/^[-*+]\s+/, '')
  // Ordered list.
  s = s.replace(/^\d+\.\s+/, '')
  return s
}

const sanitizeForFilename = (s: string): string => {
  let out = s.replace(ILLEGAL, ' ')
  // Collapse internal whitespace runs.
  out = out.replace(/\s+/g, ' ').trim()
  // Strip trailing dots and spaces — Windows hates those.
  out = out.replace(/[.\s]+$/, '')
  if (out.length <= MAX_LEN) return out
  // Cut at a word boundary if possible to avoid mid-word truncation.
  const cut = out.slice(0, MAX_LEN)
  const lastSpace = cut.lastIndexOf(' ')
  return lastSpace > MAX_LEN * 0.6 ? cut.slice(0, lastSpace) : cut
}

/**
 * Walk lines top-to-bottom, returning the first one that yields a non-empty
 * sanitized filename after stripping markdown decoration. Skips fenced code
 * delimiters and horizontal rules — they're noise that wouldn't make a good
 * filename anyway.
 */
export const deriveFilenameFromContent = (markdown: string): string | null => {
  const lines = markdown.split('\n')
  let inCodeFence = false

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Toggle code-fence state but never use a fence line as the title.
    if (/^(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence) continue

    if (line === '') continue
    // Horizontal rule: `---`, `***`, `___`.
    if (/^([-*_])\1{2,}$/.test(line)) continue

    const stripped = stripLinePrefix(line)
    const inline = stripInlineMarkdown(stripped)
    const cleaned = sanitizeForFilename(inline)
    if (cleaned.length > 0) return cleaned
  }
  return null
}
