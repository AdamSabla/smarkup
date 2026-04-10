# smarkup

A native-feeling Electron markdown editor with Tiptap (visual) + CodeMirror 6 (raw), backed by local files on disk — no cloud, no sync, just files.

## Stack

- **Electron** + **electron-vite** (React 19, TypeScript 5.9, Vite 7)
- **Shadcn UI** (new-york style) on **Tailwind CSS v4**
- **Zustand** for workspace state
- **Tiptap 3** + `tiptap-markdown` for the visual editor
- **CodeMirror 6** + `@codemirror/lang-markdown` for the raw editor
- **electron-builder** + **electron-updater** for packaging and updates
- **react-resizable-panels** for the sidebar resize handle

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start Electron in dev mode with HMR. This is the primary development loop — the Electron window is Chromium under the hood and behaves like a live browser preview. |
| `npm run dev:browser` | Start a **plain browser** dev server (Vite only, no Electron) at `http://localhost:5174`. Uses an in-memory mock of `window.api`. Useful for fast UI iteration when you don't need real file I/O. |
| `npm run typecheck` | TypeScript check for main, preload, and renderer. |
| `npm run lint` | ESLint with the electron-toolkit config. |
| `npm run format` | Prettier on everything. |
| `npm run build` | Typecheck + Electron production build (no packaging). |
| `npm run build:browser` | Production build of the renderer as a standalone web app. |
| `npm run build:unpack` | Build unpacked app bundle for quick local testing. |
| `npm run build:mac` / `build:win` / `build:linux` | Platform-specific installer builds via electron-builder. |

## Development workflow

### Option 1 — Electron dev window (recommended for most things)

```bash
npm run dev
```

This opens Electron in dev mode. The renderer runs with **full HMR**: save a React file, the window updates instantly. You get Chrome DevTools with **F12**. `window.api` is the real preload bridge, so file operations touch the actual filesystem.

### Option 2 — Browser-only preview (for fast UI/styling work)

```bash
npm run dev:browser
```

Opens `http://localhost:5174` in your default browser. The renderer runs in a plain browser tab with no Electron shell. `window.api` is replaced with an **in-memory mock** that serves two seed files (`welcome.md`, `notes.md`).

**Use this when:**
- You're iterating on a component's styling and don't care about file I/O
- You want to compare rendering across Chrome / Firefox / Safari
- The Electron dev window feels slow to restart

**Don't use this when:**
- Testing anything that writes to disk
- Testing window chrome (the browser tab has no title bar / traffic lights)
- Testing auto-updates

The mock is installed conditionally in `src/renderer/src/main.tsx` — if `window.api` is already present (real preload bridge), the mock is skipped.

## Project structure

```
.github/workflows/
  ci.yml                        Typecheck + lint + build on every push/PR
  release.yml                   Matrix build + publish installers on tag push

src/
  main/index.ts                 Electron main: window chrome, IPC, updater
  preload/
    index.ts                    Typed bridge (window.api)
    index.d.ts                  Window type augmentation
  renderer/
    index.html                  Entry point
    src/
      App.tsx                   Layout shell
      main.tsx                  React root + browser-mock installation
      store/workspace.ts        Zustand store (tabs, files, mode, updater)
      hooks/
        useShortcuts.ts         Global keyboard shortcuts
        useUpdateSubscription.ts Subscribes to main→renderer update events
      components/
        TitleBar.tsx            Custom drag-region title bar
        Sidebar.tsx             Folder picker + file list
        TabBar.tsx              Tabs with close + dirty indicator
        UpdateBanner.tsx        Shows when a new version is on GitHub
        editor/
          EditorPane.tsx        Visual/Raw mode switcher + active editor
          VisualEditor.tsx      Tiptap + tiptap-markdown + Tailwind prose
          RawEditor.tsx         CodeMirror 6 + lang-markdown
        ui/                     Shadcn components
      lib/
        utils.ts                cn() helper
        browser-mock-api.ts     In-memory mock for dev:browser mode

electron.vite.config.ts         Electron-vite config (main + preload + renderer)
vite.browser.config.ts          Standalone Vite config for dev:browser
electron-builder.yml            Packaging + GitHub publish config
```

## Keyboard shortcuts

(⌘ on macOS, Ctrl on Windows/Linux)

| Shortcut | Action |
|---|---|
| `⌘ N` | New file in current folder |
| `⌘ S` | Save active tab |
| `⌘ W` | Close active tab |
| `⌘ .` | Toggle sidebar |
| `⌘ /` | Toggle Visual / Raw editor mode |
| `Ctrl Tab` | Next tab |
| `Ctrl Shift Tab` | Previous tab |

## Releasing

### 1. Tag a release

```bash
# bump version in package.json first
git tag v0.1.0
git push origin v0.1.0
```

This triggers `.github/workflows/release.yml`, which:
1. Runs a build on macOS, Windows, and Linux runners in parallel.
2. Runs `electron-builder --publish always` on each, which uploads `.dmg`, `.exe`, `.AppImage`, `.deb` and the matching `latest*.yml` update manifests to a **draft** GitHub Release.
3. Also uploads the installers as workflow artifacts (fallback).

### 2. Publish the draft release

Go to `https://github.com/AdamSabla/smarkup/releases`, review the draft, and click **Publish**. Once published, the `latest*.yml` files become the update manifest that the installed app checks.

### 3. Auto-update behavior

The installed app (see `src/main/index.ts`) uses `electron-updater` in **manual-download mode**:

- On launch, it checks `https://github.com/AdamSabla/smarkup/releases/latest` 5 seconds after startup.
- If a newer version is available, the renderer shows an **Update banner** at the top of the window with a "Download" button.
- Clicking "Download" opens the GitHub release page in the user's default browser. The user downloads and installs manually.

Why manual download rather than silent install? Because:

1. macOS refuses to auto-relaunch unsigned apps. Silent updates on Mac require an Apple Developer ID ($99/yr).
2. Windows SmartScreen warns on unsigned installers. An EV code signing cert is ~$200+/yr.

Once you have signing in place, flip `autoUpdater.autoDownload = true` in `src/main/index.ts` and add a "Restart to update" UX.

### Code signing (when you're ready)

Uncomment the signing env vars in `.github/workflows/release.yml` and add these repository secrets:

**macOS:**
- `MAC_CERT_P12_BASE64` — Developer ID cert exported as .p12, base64-encoded
- `MAC_CERT_PASSWORD` — password for the .p12
- `APPLE_ID` — your Apple ID
- `APPLE_APP_SPECIFIC_PASSWORD` — https://appleid.apple.com → "App-Specific Passwords"
- `APPLE_TEAM_ID` — from https://developer.apple.com/account/#/membership

**Windows:**
- `WIN_CSC_LINK` — EV cert .pfx base64-encoded (or a URL)
- `WIN_CSC_KEY_PASSWORD` — cert password

## A note on repo visibility

`electron-updater` reads releases from the configured GitHub repo. If the repo is **private**, the app needs a `GH_TOKEN` to authenticate — which means embedding a token in the shipped binary. The safer pattern is:

- Keep source code private in `AdamSabla/smarkup`
- Publish **binaries only** to a separate public repo like `AdamSabla/smarkup-releases`
- Change `publish.repo` in `electron-builder.yml` and the manifest URL in `src/main/index.ts` to point there

Or just make the main repo public if you don't mind.
