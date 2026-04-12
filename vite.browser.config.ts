import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Standalone Vite config for running the renderer in a plain browser.
 * Lets you iterate on UI/styling without bundling the Electron shell.
 *
 * Run with: `npm run dev:browser`
 * Opens at: http://localhost:51740
 *
 * Note: `window.api` is mocked in-memory (see `browser-mock-api.ts`),
 * so file operations are non-persistent. Use `npm run dev` for real I/O.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 51740,
    strictPort: false,
    open: true
  },
  build: {
    outDir: resolve(__dirname, 'out/browser'),
    emptyOutDir: true
  }
})
