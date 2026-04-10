/** Strip markdown syntax and count words in the remaining text. */
export const countWords = (markdown: string): number => {
  if (!markdown) return 0
  const stripped = markdown
    // Fenced code blocks
    .replace(/```[\s\S]*?```/g, ' ')
    // Inline code
    .replace(/`[^`]*`/g, ' ')
    // Images and links — keep the label
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Headings, list markers, blockquote markers
    .replace(/^[#>\-*+]+\s+/gm, '')
    // Emphasis markers
    .replace(/[*_~]+/g, ' ')
  const words = stripped.trim().split(/\s+/).filter(Boolean)
  return words.length
}

/** Average adult reading speed ≈ 238 wpm. Returns integer minutes, min 1 if there are any words. */
export const readingMinutes = (words: number): number => {
  if (words === 0) return 0
  return Math.max(1, Math.round(words / 238))
}
