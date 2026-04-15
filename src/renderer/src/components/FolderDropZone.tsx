import { useEffect, useRef, useState } from 'react'
import { FolderPlusIcon } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'

/**
 * Full-window overlay that appears when the user drags a folder from the OS
 * into the app, and registers dropped folders as workspace folders in the
 * sidebar. Files are ignored (overlay copy tells the user only folders stick).
 *
 * Drag-enter/leave fire on every child as the pointer moves through the DOM,
 * so we keep a counter and only hide the overlay when it drops back to 0.
 */
const FolderDropZone = (): React.JSX.Element | null => {
  const addFolder = useWorkspace((s) => s.addFolder)
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const isFileDrag = (e: DragEvent): boolean =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')

    const onEnter = (e: DragEvent): void => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      depth.current += 1
      if (depth.current === 1) setDragging(true)
    }

    const onOver = (e: DragEvent): void => {
      if (!isFileDrag(e)) return
      // Must preventDefault on dragover for drop to fire.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }

    const onLeave = (e: DragEvent): void => {
      if (!isFileDrag(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }

    const onDrop = async (e: DragEvent): Promise<void> => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)

      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : []
      for (const file of files) {
        const path = window.api.getPathForFile(file)
        if (!path) continue
        const isDir = await window.api.isDirectory(path)
        if (!isDir) continue
        await addFolder(path)
      }
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [addFolder])

  if (!dragging) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="mx-8 flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-background/90 px-10 py-8 text-center shadow-lg">
        <FolderPlusIcon className="size-10 text-primary" />
        <div className="text-lg font-semibold">Drop to add folder to sidebar</div>
        <div className="text-sm text-muted-foreground">
          The folder will appear as a new section in your sidebar. Files are ignored.
        </div>
      </div>
    </div>
  )
}

export default FolderDropZone
