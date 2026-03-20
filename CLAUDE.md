# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm start          # Run the app in development mode
pnpm build          # Build distributable (AppImage on Linux)
pnpm format         # Format code with Prettier
```

No test suite is configured.

## Architecture

VORTEX is an Electron-based YouTube/media downloader GUI that shells out to `yt-dlp` and `ffmpeg`.

**Process separation:**
- `electron/main.js` — Main process: spawns yt-dlp/ffmpeg subprocesses, manages binary installation, handles file dialogs, orchestrates downloads
- `electron/preload.js` — IPC bridge: exposes `window.vortex` API to the renderer (contextBridge)
- `src/index.js` — Renderer process: all UI logic, state management via a single global `S` object
- `index.html` — Shell HTML loaded by Electron

**IPC flow:**
1. Renderer calls `window.vortex.fetchInfo(url)` → main process spawns `yt-dlp --dump-json`
2. Renderer calls `window.vortex.startDownload(opts)` → main process spawns `yt-dlp` with format selectors
3. Main process streams progress back via `win.webContents.send('download-progress', ...)`

**Binary management:**
Binaries (yt-dlp, ffmpeg) are auto-downloaded to `~/.local/share/vortex/bin/` on Linux (equivalent platform paths on Windows/macOS). The `check-tools`, `auto-install-ytdlp`, `auto-install-ffmpeg`, and `update-ytdlp` IPC handlers manage this lifecycle.

**State:** All frontend state lives in the `S` object in `src/index.js`. Download history persists to `localStorage` (max 60 items).

**Build target:** Linux AppImage (x64) is the primary target; Windows/macOS entries exist in `package.json` but are secondary.
