import { ElectronAPI } from '@electron-toolkit/preload'
import type { SmarkupApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: SmarkupApi
  }
}
