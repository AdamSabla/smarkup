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

| Command                                           | What it does                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                     | Start Electron in dev mode with HMR. This is the primary development loop — the Electron window is Chromium under the hood and behaves like a live browser preview.                               |
| `npm run dev:browser`                             | Start a **plain browser** dev server (Vite only, no Electron) at `http://localhost:5174`. Uses an in-memory mock of `window.api`. Useful for fast UI iteration when you don't need real file I/O. |
| `npm run typecheck`                               | TypeScript check for main, preload, and renderer.                                                                                                                                                 |
| `npm run lint`                                    | ESLint with the electron-toolkit config.                                                                                                                                                          |
| `npm run format`                                  | Prettier on everything.                                                                                                                                                                           |
| `npm run build`                                   | Typecheck + Electron production build (no packaging).                                                                                                                                             |
| `npm run build:browser`                           | Production build of the renderer as a standalone web app.                                                                                                                                         |
| `npm run build:unpack`                            | Build unpacked app bundle for quick local testing.                                                                                                                                                |
| `npm run build:mac` / `build:win` / `build:linux` | Platform-specific installer builds via electron-builder.                                                                                                                                          |

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

| Shortcut         | Action                                              |
| ---------------- | --------------------------------------------------- |
| `⌘ N` / `⌘ T`    | New draft in the configured drafts folder           |
| `⌘ P`            | Quick Open — fuzzy file finder                      |
| `⌘ K`            | Command Palette — commands, move file, themes, etc. |
| `⌘ S`            | Save active tab                                     |
| `⌘ W`            | Close active tab                                    |
| `⌘ ,`            | Open Settings                                       |
| `⌘ .`            | Toggle sidebar                                      |
| `⌘ /`            | Toggle Visual / Raw editor mode                     |
| `Ctrl Tab`       | Next tab                                            |
| `Ctrl Shift Tab` | Previous tab                                        |

- Tabs are draggable — grab any tab in the tab bar to reorder.
- Right-click (or double-click to rename) any file in the sidebar for rename / delete actions.
- Open tabs and the active tab are persisted across restarts.
- External edits to open files are detected by the file watcher and re-loaded automatically if the tab is clean.

## Releasing

### 1. Tag a release

```bash
# bump version in package.json first
git tag v0.1.0
git push origin v0.1.0
```

This triggers `.github/workflows/release.yml`, which:

1. Runs a build on macOS, Windows, and Linux runners in parallel.
2. Runs `electron-builder --publish always` on each, which uploads `.dmg`, `.zip` (mac), `.exe`, `.AppImage`, `.deb` and the matching `latest*.yml` update manifests to a **draft** GitHub Release. The `.zip` is what `electron-updater` downloads to apply updates on macOS; the `.dmg` is only for first install.
3. Also uploads the installers as workflow artifacts (fallback).

### 2. Publish the draft release

Go to `https://github.com/AdamSabla/smarkup/releases`, review the draft, and click **Publish**. `electron-updater` only sees **published** (non-draft) releases, so installed apps won't discover the update until this step is done. Keeping `releaseType: draft` in `electron-builder.yml` gives you a safety net — the build can ship without users seeing it immediately.

### 3. Auto-update behavior

The installed app uses `electron-updater` in **silent-download mode** (see `src/main/index.ts`):

1. On launch, 5 seconds after startup, the app checks `https://github.com/AdamSabla/smarkup/releases/latest`.
2. If a newer version is available, the update banner shows "Downloading smarkup vX.Y.Z…" and the download starts in the background.
3. While downloading, the banner shows a progress bar.
4. When the download finishes, the banner switches to "smarkup vX.Y.Z is ready. Restart to install." with a **Restart now** button.
   - Clicking **Restart now** quits the app and relaunches into the new version immediately.
   - Clicking the X dismisses the banner; the update is applied automatically on the next quit (`autoInstallOnAppQuit = true`).
5. Users can also trigger a check manually via the command palette (⌘K → "Check for updates").

Platform nuances:

- **Windows / Linux:** works out of the box whether or not the build is signed. SmartScreen may warn on unsigned Windows installers on first install until reputation builds, but updates themselves work.
- **macOS:** auto-update **requires a signed and notarized build**. `electron-updater` validates the downloaded ZIP's code signature against the running app and silently refuses to apply an unsigned update. See "Code signing on macOS" below.

### Code signing on macOS (required for Mac auto-update)

Without this, Mac users will see the banner but the install will quietly fail, and every first-install will be blocked by Gatekeeper. This is a hard requirement from Apple — there is no workaround.

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/) ($99/year).
2. In Xcode → Settings → Accounts, create a **Developer ID Application** certificate. Export it from Keychain as a `.p12` with a password.
3. Create an app-specific password at [appleid.apple.com](https://appleid.apple.com) → App-Specific Passwords.
4. Look up your Team ID at [developer.apple.com/account](https://developer.apple.com/account) → Membership Details.
5. Add these GitHub Actions secrets (Settings → Secrets and variables → Actions):
   - `MAC_CERT_P12_BASE64` — `base64 -i cert.p12 | pbcopy`
   - `MAC_CERT_PASSWORD` — the `.p12` password
   - `APPLE_ID` — your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD` — the app-specific password from step 3
   - `APPLE_TEAM_ID` — from step 4
6. In `electron-builder.yml`, flip `mac.notarize` from `false` to `true`.

The release workflow (`.github/workflows/release.yml`) already references these secrets, so once they exist the next tagged build signs and notarizes automatically.

### Code signing on Windows (optional)

Windows auto-update works unsigned, but users will see a SmartScreen warning on first install. To eliminate it:

- `WIN_CSC_LINK` — .pfx cert base64-encoded (or a URL)
- `WIN_CSC_KEY_PASSWORD` — cert password

An EV code signing cert costs ~$200+/year and builds SmartScreen reputation immediately; a standard OV cert is cheaper but takes weeks to months of installs to warm up.

## A note on repo visibility

`electron-updater` reads releases from the configured GitHub repo. If the repo is **private**, the app needs a `GH_TOKEN` to authenticate — which means embedding a token in the shipped binary. The safer pattern is:

- Keep source code private in `AdamSabla/smarkup`
- Publish **binaries only** to a separate public repo like `AdamSabla/smarkup-releases`
- Change `publish.repo` in `electron-builder.yml` and the manifest URL in `src/main/index.ts` to point there

Or just make the main repo public if you don't mind.
