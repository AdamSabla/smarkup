/**
 * Minimal JSON-backed settings store. Persisted to
 * `<userData>/settings.json`. Plain fs instead of electron-store because
 * the latter ships as ESM-only and needs dynamic import gymnastics under
 * electron-vite's CJS main bundle.
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

export type Theme = 'light' | 'dark' | 'system'

export type Settings = {
  draftsFolder: string | null
  additionalFolders: string[]
  theme: Theme
  sidebarVisible: boolean
  editorMode: 'visual' | 'raw'
  tabOrder: string[]
}

const DEFAULT_SETTINGS: Settings = {
  draftsFolder: null,
  additionalFolders: [],
  theme: 'system',
  sidebarVisible: true,
  editorMode: 'visual',
  tabOrder: []
}

let cached: Settings | null = null

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

export const loadSettings = async (): Promise<Settings> => {
  if (cached) return cached
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    cached = { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    cached = { ...DEFAULT_SETTINGS }
  }
  return cached
}

export const saveSettings = async (patch: Partial<Settings>): Promise<Settings> => {
  const current = await loadSettings()
  const next = { ...current, ...patch }
  cached = next
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}
