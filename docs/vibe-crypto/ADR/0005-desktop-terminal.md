# ADR 0005: Cross-platform desktop and embedded Claude terminal

Status: accepted
Date: 2026-11-13

## Context

`desktop/electron/` is an Electron 43 shell that starts the Python backend and
loads the web UI from it. It is Windows-only today:

- `prepare-electron.mjs` downloads only `electron-v<ver>-win32-x64.zip`.
- `backend-manager.ts` looks for `Scripts\vibe-trading.exe` and `python.exe`.
- `package.json` only has `win`/`nsis` builder targets and Windows scripts;
  CI is `desktop-windows.yml`.
- The Windows installer bundles an embedded Python runtime built by
  `build-backend.ps1`.

We also want a terminal panel that runs the user's local `claude` CLI with the
Vibe Crypto MCP server pre-wired.

## Decision

1. **Cross-platform resolution.** Backend lookup becomes platform aware:
   `Scripts\vibe-crypto.exe` / `python.exe` on Windows, `bin/vibe-crypto` /
   `bin/python3` on macOS and Linux, with `vibe-trading` names as fallback.
   `VIBE_TRADING_EXECUTABLE` still overrides.
2. **Dev run on every OS.** `npm start` uses the Electron binary from
   `node_modules/electron`; `prepare-electron.mjs` downloads the archive for
   `process.platform`/`process.arch` and is only needed for packaging.
3. **Packaging.** electron-builder targets: Windows `nsis` (bundled Python, as
   today), macOS `dmg`+`zip`, Linux `AppImage`+`deb`. On macOS and Linux the
   package does **not** bundle Python: it uses `vibe-crypto` from PATH, the
   source `.venv`, or `VIBE_TRADING_EXECUTABLE`, and the loading screen tells
   the user how to install it. CI (amended 2026-11-14, user request): the
   platform-neutral desktop tests run on Linux in `test.yml`, and
   `desktop-windows.yml` is the only build workflow (Windows NSIS installer,
   uploaded as a workflow artifact). macOS and Linux packages are built
   locally with `npm run dist:mac` / `dist:linux`.
4. **Embedded terminal.** `node-pty` in the main process, `@xterm/xterm` +
   `@xterm/addon-fit` in the renderer. Main writes
   `<userData>/claude-mcp.json` pointing at the backend's MCP entry point and
   spawns `claude --mcp-config <file>` in the user's home directory. IPC is a
   narrow `vibeDesktop.terminal` API (start, write, resize, kill, onData,
   onExit) validated against the main window sender, one PTY at a time. If
   `claude` is not on PATH, the terminal prints install instructions.
5. The desktop no longer injects an API key (ADR 0002).

## Consequences

- Developers on any OS can `npm start` the desktop app against a local venv.
- macOS/Linux users install the Python package once; Windows users get the
  bundled runtime. Bundling Python on macOS/Linux is a follow-up (open risk).
- `node-pty` is a native module: packaging runs electron-builder's native
  rebuild and unpacks it from asar; dev uses `npm run rebuild:native`.
- Unsigned macOS builds need right-click Open; signing is a follow-up.

## Alternatives rejected

- **Bundle Python everywhere now (python-build-standalone).** Large build work
  per OS/arch before anyone needs it. Deferred.
- **Terminal over a WebSocket served by the Python backend.** A PTY exposed on
  a local HTTP port is a remote-code-execution surface. Rejected; IPC keeps it
  inside the Electron process.
- **Write the MCP server into the user's `~/.claude.json`.** Mutates user
  config silently. `--mcp-config` scopes it to the embedded session.
