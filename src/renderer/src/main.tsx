import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installBrowserMockApi } from './lib/browser-mock-api'

// When the preload bridge isn't present (e.g. running `npm run dev:browser`)
// install an in-memory mock so the UI can render and iterate.
installBrowserMockApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
