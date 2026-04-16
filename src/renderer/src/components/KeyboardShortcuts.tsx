import { useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useWorkspace } from '@/store/workspace'

const isMac = navigator.userAgent.toLowerCase().includes('mac')
const mod = isMac ? '⌘' : 'Ctrl'

const shortcuts: { section: string; items: { label: string; keys: string }[] }[] = [
  {
    section: 'General',
    items: [
      { label: 'New draft', keys: `${mod} N` },
      { label: 'Open file…', keys: `${mod} O` },
      { label: 'Save', keys: `${mod} S` },
      { label: 'Quick open', keys: `${mod} P` },
      { label: 'Command palette', keys: `${mod} K` },
      { label: 'Settings', keys: `${mod} ,` },
      { label: 'Keyboard shortcuts', keys: `${mod} Shift /` },
      { label: 'Toggle variables panel', keys: `${mod} Shift V` }
    ]
  },
  {
    section: 'Editor',
    items: [
      { label: 'Toggle visual / raw mode', keys: `${mod} ;` },
      { label: 'Rename file', keys: `${mod} R` },
      { label: 'Split pane', keys: `${mod} \\` },
      { label: 'Toggle bullet list', keys: `${mod} Shift 8` },
      { label: 'Toggle numbered list', keys: `${mod} Shift 7` },
      { label: 'Toggle checklist', keys: `${mod} Shift L` },
      { label: 'Toggle checkbox', keys: `${mod} Enter` }
    ]
  },
  {
    section: 'Tabs & Sidebar',
    items: [
      { label: 'Close tab / pane', keys: `${mod} W` },
      { label: 'Next tab', keys: 'Ctrl Tab' },
      { label: 'Previous tab', keys: 'Ctrl Shift Tab' },
      { label: 'Toggle sidebar', keys: `${mod} .` }
    ]
  }
]

const Kbd = ({ children }: { children: string }): React.JSX.Element => (
  <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted/50 px-1 text-[11px] font-medium text-muted-foreground">
    {children}
  </kbd>
)

const KeyboardShortcuts = (): React.JSX.Element => {
  const open = useWorkspace((s) => s.shortcutsOpen)
  const close = useWorkspace((s) => s.closeShortcuts)

  useEffect(() => {
    return window.api.onShowShortcuts(() => {
      useWorkspace.getState().openShortcuts()
    })
  }, [])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto -mx-1 px-1">
          {shortcuts.map((group) => (
            <div key={group.section} className="mb-4 last:mb-0">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.section}
              </h3>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between text-sm">
                    <span>{item.label}</span>
                    <span className="flex gap-0.5">
                      {item.keys.split(' ').map((k, i) => (
                        <Kbd key={i}>{k}</Kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default KeyboardShortcuts
