import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/store/workspace'
import FileSearchPopover from '@/components/FileSearchPopover'

const DiffPickerDialog = (): React.JSX.Element => {
  const open = useWorkspace((s) => s.diffPickerOpen)
  const prefill = useWorkspace((s) => s.diffPickerPrefill)
  const closePicker = useWorkspace((s) => s.closeDiffPicker)
  const openDiff = useWorkspace((s) => s.openDiff)

  const [leftPath, setLeftPath] = useState<string>('')
  const [rightPath, setRightPath] = useState<string>('')

  // Reset selections when dialog opens
  useEffect(() => {
    if (open) {
      setLeftPath(prefill?.leftPath ?? '')
      setRightPath('')
    }
  }, [open, prefill])

  const canCompare = leftPath && rightPath && leftPath !== rightPath

  const handleBrowse = async (side: 'left' | 'right'): Promise<void> => {
    const path = await window.api.openFile()
    if (path) {
      if (side === 'left') setLeftPath(path)
      else setRightPath(path)
    }
  }

  const handleCompare = (): void => {
    if (!canCompare) return
    void openDiff(leftPath, rightPath)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closePicker()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compare Files</DialogTitle>
          <DialogDescription>Select two files to compare side by side.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Left file */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Left file</label>
            <div className="flex items-center gap-2">
              <FileSearchPopover
                value={leftPath || null}
                onSelect={setLeftPath}
                className="flex-1"
                variant="outlined"
              />
              <Button variant="outline" size="sm" onClick={() => void handleBrowse('left')}>
                Browse...
              </Button>
            </div>
          </div>

          {/* Right file */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Right file</label>
            <div className="flex items-center gap-2">
              <FileSearchPopover
                value={rightPath || null}
                onSelect={setRightPath}
                className="flex-1"
                variant="outlined"
              />
              <Button variant="outline" size="sm" onClick={() => void handleBrowse('right')}>
                Browse...
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={closePicker}>
            Cancel
          </Button>
          <Button disabled={!canCompare} onClick={handleCompare}>
            Compare
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default DiffPickerDialog
