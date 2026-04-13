import { useEffect, useState } from 'react'
import {
  ArrowLeftIcon,
  ClipboardIcon,
  ColumnsIcon,
  EyeIcon,
  FileClockIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
  MonitorIcon,
  MoonIcon,
  MoveIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  SaveAllIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  SunIcon,
  TrashIcon,
  XIcon
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import Spinner from '@/components/ui/spinner'
import { useWorkspace } from '@/store/workspace'

type Page = 'commands' | 'movePicker' | 'createFolder'

const CommandPaletteBody = (): React.JSX.Element => {
  // Subscribe with shallow equality so the body doesn't re-render on
  // unrelated store changes (e.g. the active tab's content changing while
  // the user is typing in the editor). The palette is permanently mounted
  // for instant open, so avoiding extra renders matters.
  const {
    closeCommandPalette,
    openQuickOpen,
    openSettings,
    createDraft,
    saveActive,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    activeTabId,
    tabs,
    additionalFolders,
    addFolder,
    removeFolder,
    setDraftsFolder,
    setTheme,
    setEditorMode,
    editorMode,
    toggleSidebar,
    sidebarVisible,
    deleteFile,
    moveFile,
    checkForUpdates,
    recentFiles,
    openFile,
    autoSave,
    setAutoSave,
    splitPane,
    activePaneId,
    commandPaletteOpen,
    moveTargets,
    moveTargetsLoading,
    refreshMoveTargets
  } = useWorkspace(
    useShallow((s) => ({
      closeCommandPalette: s.closeCommandPalette,
      openQuickOpen: s.openQuickOpen,
      openSettings: s.openSettings,
      createDraft: s.createDraft,
      saveActive: s.saveActive,
      closeTab: s.closeTab,
      closeOtherTabs: s.closeOtherTabs,
      closeAllTabs: s.closeAllTabs,
      activeTabId: s.activeTabId,
      tabs: s.tabs,
      additionalFolders: s.additionalFolders,
      addFolder: s.addFolder,
      removeFolder: s.removeFolder,
      setDraftsFolder: s.setDraftsFolder,
      setTheme: s.setTheme,
      setEditorMode: s.setEditorMode,
      editorMode: s.editorMode,
      toggleSidebar: s.toggleSidebar,
      sidebarVisible: s.sidebarVisible,
      deleteFile: s.deleteFile,
      moveFile: s.moveFile,
      checkForUpdates: s.checkForUpdates,
      recentFiles: s.recentFiles,
      openFile: s.openFile,
      autoSave: s.autoSave,
      setAutoSave: s.setAutoSave,
      splitPane: s.splitPane,
      activePaneId: s.activePaneId,
      commandPaletteOpen: s.commandPaletteOpen,
      moveTargets: s.moveTargets,
      moveTargetsLoading: s.moveTargetsLoading,
      refreshMoveTargets: s.refreshMoveTargets
    }))
  )

  const [page, setPage] = useState<Page>('commands')
  const [query, setQuery] = useState('')

  const activeTab = tabs.find((t) => t.id === activeTabId)

  // Reset query when switching pages
  const goTo = (next: Page): void => {
    setPage(next)
    setQuery('')
  }

  // Reset internal state every time the palette re-opens so it always starts
  // on the commands page with an empty query.
  useEffect(() => {
    if (commandPaletteOpen) {
      // Legitimate sync from an external "palette opened" event.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage('commands')
      setQuery('')
    }
  }, [commandPaletteOpen])

  // Re-focus the cmdk input after page transitions
  useEffect(() => {
    if (!commandPaletteOpen) return
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]')
      input?.focus()
    })
  }, [page, commandPaletteOpen])

  // If the user ever lands on the move picker and we somehow have no cached
  // targets, kick off a refresh — normally the store keeps them warm.
  useEffect(() => {
    if (page === 'movePicker' && moveTargets.length === 0 && !moveTargetsLoading) {
      void refreshMoveTargets()
    }
  }, [page, moveTargets.length, moveTargetsLoading, refreshMoveTargets])

  const dismiss = (): void => {
    closeCommandPalette()
  }

  // --- Create folder page state ------------------------------------------
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')

  const handleCreateAndMove = async (): Promise<void> => {
    if (!newFolderParent || !newFolderName.trim() || !activeTab) return
    try {
      const newDir = await window.api.createDirectory(newFolderParent, newFolderName.trim())
      await moveFile(activeTab.path, newDir)
      dismiss()
    } catch (err) {
      console.error('Failed to create folder', err)
    }
  }

  // --- Page: commands ----------------------------------------------------
  if (page === 'commands') {
    return (
      <Command label="Command palette">
        <CommandInput placeholder="Type a command…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No commands match.</CommandEmpty>

          {recentFiles.length > 0 && (
            <>
              <CommandGroup heading="Recent files">
                {recentFiles.slice(0, 5).map((path) => {
                  const name = path.split('/').pop() ?? path
                  const displayName = name.replace(/\.md$/i, '')
                  return (
                    <CommandItem
                      key={path}
                      value={`recent ${displayName} ${path}`}
                      onSelect={() => {
                        void openFile(path)
                        dismiss()
                      }}
                    >
                      <FileClockIcon />
                      <span className="truncate">{displayName}</span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          <CommandGroup heading="File">
            <CommandItem
              onSelect={() => {
                void createDraft()
                dismiss()
              }}
            >
              <FilePlusIcon /> New draft
            </CommandItem>
            <CommandItem
              onSelect={() => {
                dismiss()
                openQuickOpen()
              }}
            >
              <SearchIcon /> Open file…
            </CommandItem>
            {activeTab && (
              <>
                <CommandItem
                  onSelect={() => {
                    void saveActive()
                    dismiss()
                  }}
                >
                  <SaveIcon /> Save
                </CommandItem>
                <CommandItem onSelect={() => goTo('movePicker')}>
                  <MoveIcon /> Move file…
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    void window.api.revealInFolder(activeTab.path)
                    dismiss()
                  }}
                >
                  <FolderIcon /> Reveal in file manager
                </CommandItem>
                <CommandItem
                  onSelect={() => {
                    void navigator.clipboard.writeText(activeTab.path)
                    dismiss()
                  }}
                >
                  <ClipboardIcon /> Copy file path
                </CommandItem>
                <CommandItem
                  className="text-destructive [&_svg]:text-destructive data-[selected=true]:bg-destructive/10 data-[selected=true]:text-destructive"
                  onSelect={() => {
                    void deleteFile(activeTab.path)
                    dismiss()
                  }}
                >
                  <TrashIcon /> Delete file
                </CommandItem>
              </>
            )}
          </CommandGroup>

          {tabs.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Tabs">
                {activeTabId && (
                  <CommandItem
                    onSelect={() => {
                      closeTab(activeTabId)
                      dismiss()
                    }}
                  >
                    <XIcon /> Close tab
                  </CommandItem>
                )}
                {activeTabId && tabs.length > 1 && (
                  <CommandItem
                    onSelect={() => {
                      closeOtherTabs(activeTabId)
                      dismiss()
                    }}
                  >
                    <XIcon /> Close other tabs
                  </CommandItem>
                )}
                <CommandItem
                  onSelect={() => {
                    closeAllTabs()
                    dismiss()
                  }}
                >
                  <XIcon /> Close all tabs
                </CommandItem>
              </CommandGroup>
            </>
          )}

          <CommandSeparator />
          <CommandGroup heading="View">
            <CommandItem
              onSelect={() => {
                void toggleSidebar()
                dismiss()
              }}
            >
              <SidebarIcon /> {sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
            </CommandItem>
            {activeTabId && (
              <CommandItem
                onSelect={() => {
                  splitPane(activePaneId, 'horizontal', activeTabId)
                  dismiss()
                }}
              >
                <ColumnsIcon /> Split editor
              </CommandItem>
            )}
            <CommandItem
              onSelect={() => {
                void setEditorMode(editorMode === 'visual' ? 'raw' : 'visual')
                dismiss()
              }}
            >
              <EyeIcon /> Switch to {editorMode === 'visual' ? 'Raw' : 'Visual'} mode
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Editor">
            <CommandItem
              onSelect={() => {
                void setAutoSave(!autoSave)
                dismiss()
              }}
            >
              <SaveAllIcon /> {autoSave ? 'Disable auto-save' : 'Enable auto-save'}
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Appearance">
            <CommandItem
              onSelect={() => {
                void setTheme('light')
                dismiss()
              }}
            >
              <SunIcon /> Theme: Light
            </CommandItem>
            <CommandItem
              onSelect={() => {
                void setTheme('dark')
                dismiss()
              }}
            >
              <MoonIcon /> Theme: Dark
            </CommandItem>
            <CommandItem
              onSelect={() => {
                void setTheme('system')
                dismiss()
              }}
            >
              <MonitorIcon /> Theme: System
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="Workspace">
            <CommandItem
              onSelect={async () => {
                const chosen = await window.api.openDirectory()
                if (chosen) await addFolder(chosen)
                dismiss()
              }}
            >
              <FolderPlusIcon /> Add folder to sidebar
            </CommandItem>
            <CommandItem
              onSelect={async () => {
                const chosen = await window.api.openDirectory()
                if (chosen) await setDraftsFolder(chosen)
                dismiss()
              }}
            >
              <PencilIcon /> Set drafts folder…
            </CommandItem>
            {additionalFolders.map((folder) => (
              <CommandItem
                key={folder}
                onSelect={() => {
                  void removeFolder(folder)
                  dismiss()
                }}
              >
                <XIcon /> Remove folder: {folder.split('/').pop()}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />
          <CommandGroup heading="App">
            <CommandItem
              onSelect={() => {
                dismiss()
                openSettings()
              }}
            >
              <SettingsIcon /> Open Settings
            </CommandItem>
            <CommandItem
              onSelect={() => {
                void checkForUpdates()
                dismiss()
              }}
            >
              <RefreshCwIcon /> Check for updates
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    )
  }

  // --- Page: movePicker --------------------------------------------------
  if (page === 'movePicker') {
    const hasTargets = moveTargets.length > 0
    return (
      <Command label="Move file to folder">
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <button
            onClick={() => goTo('commands')}
            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-accent"
          >
            <ArrowLeftIcon className="size-3" />
            Back
          </button>
          <span className="truncate">
            Move <span className="font-medium text-foreground">{activeTab?.name}</span> to…
          </span>
        </div>
        <CommandInput placeholder="Search folders…" value={query} onValueChange={setQuery} />
        <CommandList>
          {!hasTargets && moveTargetsLoading && (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Spinner />
              <span>Loading folders…</span>
            </div>
          )}
          {!hasTargets && !moveTargetsLoading && (
            <CommandEmpty>No folders found. Configure your sidebar first.</CommandEmpty>
          )}
          {hasTargets && (
            <CommandGroup heading="Folders">
              {moveTargets.map((target) => (
                <CommandItem
                  key={target.path}
                  value={target.label + ' ' + target.path}
                  onSelect={() => {
                    if (!activeTab) return
                    void moveFile(activeTab.path, target.path)
                    dismiss()
                  }}
                >
                  <FolderIcon />
                  <span className="truncate">{target.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {hasTargets && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Create new">
                {moveTargets.map((target) => (
                  <CommandItem
                    key={'new-in-' + target.path}
                    value={'create new folder in ' + target.label}
                    onSelect={() => {
                      setNewFolderParent(target.path)
                      setNewFolderName('')
                      goTo('createFolder')
                    }}
                  >
                    <FolderPlusIcon />
                    New folder in {target.label}…
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    )
  }

  // --- Page: createFolder ------------------------------------------------
  return (
    <Command label="Create new folder" shouldFilter={false}>
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        <button
          onClick={() => goTo('movePicker')}
          className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-accent"
        >
          <ArrowLeftIcon className="size-3" />
          Back
        </button>
        <span className="truncate">
          New folder in <span className="font-medium text-foreground">{newFolderParent}</span>
        </span>
      </div>
      <div className="px-3 py-3">
        <input
          autoFocus
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleCreateAndMove()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              goTo('movePicker')
            }
          }}
          placeholder="Folder name"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Press Enter to create the folder and move the file here.
        </p>
      </div>
    </Command>
  )
}

const CommandPalette = (): React.JSX.Element => {
  const commandPaletteOpen = useWorkspace((s) => s.commandPaletteOpen)
  const closeCommandPalette = useWorkspace((s) => s.closeCommandPalette)

  return (
    <Dialog open={commandPaletteOpen} onOpenChange={(open) => !open && closeCommandPalette()}>
      {/*
       * `forceMount` keeps the palette's React tree alive between opens,
       * so the first Cmd+K press doesn't pay the cold-mount cost of
       * Radix Dialog + cmdk + all the CommandItems.
       */}
      <DialogContent forceMount className="max-w-xl gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Run commands or move the active file to another folder.
        </DialogDescription>
        <CommandPaletteBody />
      </DialogContent>
    </Dialog>
  )
}

export default CommandPalette
