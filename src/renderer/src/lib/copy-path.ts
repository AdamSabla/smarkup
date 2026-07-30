import { useWorkspace } from '@/store/workspace'

/** Longest name we'll spell out in a menu label before eliding it. */
const MAX_LABEL_NAME = 28

const basename = (path: string): string => path.split(/[/\\]/).pop() || path

/**
 * Finder's own wording, down to the curly quotes: `Copy “file.md” as
 * Pathname`. Long names are elided so one deep file can't stretch the menu
 * across the window.
 */
export const copyPathLabel = (path: string): string => {
  const name = basename(path)
  const shown = name.length > MAX_LABEL_NAME ? `${name.slice(0, MAX_LABEL_NAME - 1)}…` : name
  return `Copy “${shown}” as Pathname`
}

/**
 * Put a file or folder's absolute path on the clipboard.
 *
 * Confirmed with a toast because the clipboard gives no feedback of its own,
 * and a menu item that looks like it did nothing is indistinguishable from one
 * that failed.
 */
export const copyPath = async (path: string): Promise<void> => {
  const { showToast } = useWorkspace.getState()
  try {
    await window.api.copyToClipboard(path)
    showToast(`Copied path to “${basename(path)}”`)
  } catch {
    showToast("Couldn't copy the path to the clipboard", 'error')
  }
}
