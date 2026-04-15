import { useEffect, useMemo, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useWorkspace, type OpenFile, type PendingClose } from '@/store/workspace'

const stripExt = (name: string): string => name.replace(/\.md$/i, '')

/** Find the tabs affected by the pending close action. */
const scopeTabs = (pc: PendingClose, tabs: OpenFile[]): OpenFile[] => {
  switch (pc.kind) {
    case 'tab':
      return tabs.filter((t) => t.id === pc.tabId)
    case 'others':
      return tabs.filter((t) => t.id !== pc.keepTabId)
    case 'all':
    case 'window':
      return tabs
  }
}

const UnsavedChangesDialog = (): React.JSX.Element => {
  const pendingClose = useWorkspace((s) => s.pendingClose)
  const tabs = useWorkspace((s) => s.tabs)
  const resolvePendingClose = useWorkspace((s) => s.resolvePendingClose)

  const saveBtnRef = useRef<HTMLButtonElement>(null)

  // Snapshot the dirty-tabs list when the dialog opens, so the text and
  // buttons don't shift if the underlying tabs list changes while the
  // dialog is showing (e.g. a file-watcher event). The memo only re-runs
  // when `pendingClose` identity changes — i.e. on each new close attempt.
  const dirtyTabs = useMemo<OpenFile[]>(() => {
    if (!pendingClose) return []
    return scopeTabs(pendingClose, tabs).filter((t) => t.content !== t.savedContent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingClose])

  const open = pendingClose !== null && dirtyTabs.length > 0

  // Autofocus the primary action so Enter = Save.
  useEffect(() => {
    if (open) {
      // Wait a frame so Radix has mounted the content.
      const id = requestAnimationFrame(() => saveBtnRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
    return undefined
  }, [open])

  const { title, description, saveLabel } = useMemo(() => {
    const count = dirtyTabs.length
    if (count === 1) {
      const name = stripExt(dirtyTabs[0].name)
      return {
        title: `Do you want to save the changes you made to “${name}”?`,
        description: "Your changes will be lost if you don't save them.",
        saveLabel: 'Save'
      }
    }
    return {
      title: `You have unsaved changes in ${count} documents.`,
      description: "Your changes will be lost if you don't save them.",
      saveLabel: 'Save All'
    }
  }, [dirtyTabs])

  const onSave = (): void => void resolvePendingClose('save')
  const onDiscard = (): void => void resolvePendingClose('discard')
  const onCancel = (): void => void resolvePendingClose('cancel')

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(e) => {
          // macOS-style accelerator: Cmd+D = Don't Save
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
            e.preventDefault()
            onDiscard()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {dirtyTabs.length > 1 && (
          <ul className="max-h-40 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 text-sm">
            {dirtyTabs.map((t) => (
              <li key={t.id} className="truncate py-0.5 font-medium">
                {stripExt(t.name)}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onDiscard}>
            Don&apos;t Save
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button ref={saveBtnRef} onClick={onSave}>
            {saveLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default UnsavedChangesDialog
