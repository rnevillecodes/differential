# Design

## Context

- The backend (`src-tauri/src`) is a set of Tauri commands registered in `lib.rs::configure`, which wrap `git` and run blocking work through `commands::blocking`. Nothing in the app is long-lived or stateful today apart from `InitialArgs` in managed state, and nothing streams data to the webview: every command is request/response.
- The frontend is React 19 + a single zustand store (`src/store.ts`) built by `createAppStore(api, storage)`, with all backend access behind the `Api` interface (`src/api/index.ts`) so tests inject a mock. Preferences persist through the `KeyValue` storage (`differential.*` keys in localStorage).
- Layout: `.app` is a two-row grid (toolbar, main); `.main` is a two-column grid (sidebar, `DiffPane`). Global shortcuts live in `App.tsx::handleShortcut`, which handles Ctrl-combos even when focus is in an input.
- `capabilities/default.json` grants only `core:default` and `dialog:allow-open`, and states that no shell access is exposed to the webview. The CSP is `null`; the webview only loads the bundled UI.
- Theme comes from CSS custom properties (`--bg`, `--fg`, …) switched by `prefers-color-scheme`.

## Goals / Non-Goals

**Goals:**
- A PTY-backed terminal that behaves like a real terminal on Windows (ConPTY), macOS, and Linux.
- Output streaming that stays smooth under heavy output (e.g. a verbose test run) without blocking the UI or other commands.
- Terminal sessions that survive hiding the panel and switching tabs or repositories, and that never outlive the app.
- Keep the store and components testable with the existing mock-`Api` pattern.

**Non-Goals:**
- Choosing a shell, shell profiles, fonts, or other terminal settings (fixed defaults for now).
- Split panes, terminals in the main tab area, or dragging terminals around.
- Restoring sessions or scrollback after restart.
- Search in scrollback, link detection, or shell integration (cwd tracking, command marks).
- Any coupling between terminal activity and the diff (see spec "No automatic actions").

## Decisions

### PTY backend: `portable-pty`
Use the `portable-pty` crate (from wezterm) for spawning the shell in a pseudo-terminal. It wraps ConPTY on Windows and `openpty` on Unix behind one API (`native_pty_system`, `MasterPty::resize`, `take_writer`, `try_clone_reader`, `Child::wait/kill`).
- *Alternatives:* a community `tauri-plugin-pty` (thin, less maintained, adds a plugin permission surface we do not otherwise need); hand-written ConPTY + `nix` (much more code for the same result); plain pipes without a PTY (breaks interactive programs, colors, `Ctrl+C` — ruled out by the spec).

### Session manager in managed state
A new `terminal` module holds a `TerminalManager` registered with `.manage(...)` in `configure`: `Mutex<HashMap<u32, Session>>` plus an incrementing id. A `Session` owns the PTY master (for resize), the writer, and a child killer. Per session, two threads:
- **reader**: blocking reads (64 KiB buffer) from the PTY, forwarding each chunk to the webview;
- **waiter**: `child.wait()`, then removes/drops the master so the reader reaches EOF (required on Windows, where ConPTY keeps the pipe open until the pseudoconsole is closed), joins the reader, and only then reports the exit — so the exit message always follows the last output.

Commands (all thin, registered in `generate_handler!`):
- `terminal_spawn(cwd, cols, rows, on_data: Channel, on_exit: Channel) -> u32`
- `terminal_write(id, data: String)`
- `terminal_resize(id, cols, rows)`
- `terminal_close(id)` — kill the child, drop the session (idempotent; unknown ids are a no-op).

Errors use the existing `AppError`/`ErrorPayload` path (`Io` kind for spawn failures, with the shell name in the message), so the frontend shows them like other errors.

### Streaming with Tauri IPC channels, raw bytes
Output goes over a `tauri::ipc::Channel` passed into `terminal_spawn`, sending raw bytes (`InvokeResponseBody::Raw`) so the webview receives an `ArrayBuffer` that is handed straight to `xterm.write(Uint8Array)`. xterm decodes UTF-8 itself and copes with multi-byte sequences split across chunks, so the backend never decodes. Exit is sent on a second, JSON channel as `{ code: number | null }`.
- *Alternatives:* global `emit` events (broadcast to every listener, JSON-serialised, ordered less tightly — worse for high-volume streams); JSON `Vec<u8>` (serialises bytes as a number array, ~4× larger); base64 strings (workable fallback if raw channel bodies prove awkward on some platform).

### Shell selection and environment
Resolved in Rust (the webview never chooses the executable):
- Windows: `pwsh.exe` if found on `PATH`, else `powershell.exe`; args `-NoLogo`.
- macOS: `$SHELL` (fallback `/bin/zsh`) started as a login shell (`-l`), because GUI-launched apps get a minimal `PATH` and users expect their profile.
- Linux/other: `$SHELL`, fallback `/bin/sh`, no extra args.
- Environment: inherit the app's, plus `TERM=xterm-256color` and `COLORTERM=truecolor`. `cwd` must be an existing directory (validated; otherwise an error).

A pure `resolve_shell(os, env, path_lookup)` function makes this unit-testable.

### Ending processes
`terminal_close` calls the child killer and drops the master. On Unix, closing the master hangs up the terminal, delivering `SIGHUP` to the shell's process group (its jobs); on Windows, closing the pseudoconsole terminates the console processes attached to it. On app exit, a `RunEvent::Exit` handler (in `run()`) calls `TerminalManager::close_all()`. If manual testing shows Windows grandchildren surviving (e.g. a detached `node` server), wrap each shell in a Job Object with `KILL_ON_JOB_CLOSE` — kept as a contingency task rather than built up front.

### Frontend: xterm instances live outside React state
Use `@xterm/xterm` with `@xterm/addon-fit`. A small `src/terminal/sessions.ts` registry maps a frontend tab id → `{ term: Terminal, fit: FitAddon, backendId, element }`. It creates the xterm, opens it in a detached `div`, fits it, then calls `api.terminalSpawn` with callbacks that write into it. React components only *attach* that element into the visible container, so:
- hiding the panel or switching tabs never destroys scrollback (inactive terminals are kept mounted with `display: none`, and fitting is skipped while their size is 0);
- React StrictMode double-mounts cannot spawn two shells (the registry is idempotent per tab id).

The store gets a terminal slice holding only serialisable metadata: `terminalOpen`, `terminalHeight` (both persisted under `differential.terminalOpen` / `differential.terminalHeight`), `terminals: { id, title, status: "starting" | "running" | { failed: message } }[]`, `activeTerminal`, and actions `toggleTerminal`, `newTerminal`, `closeTerminal`, `setActiveTerminal`, `setTerminalHeight`. `closeTerminal` calls into the registry (which calls `api.terminalClose` and disposes the xterm). Tab titles are "Terminal 1", "Terminal 2", … (shell-set titles via `onTitleChange` may override).

`Api` gains `terminalSpawn`, `terminalWrite`, `terminalResize`, `terminalClose`; `tauriApi` implements them with `invoke` and `new Channel()`.

Resizing: a `ResizeObserver` on the panel body triggers `fit()` (debounced with `requestAnimationFrame`) and `onResize` forwards `cols`/`rows` to `terminal_resize`.

### Layout
The right-hand column of `.main` becomes a vertical stack: `DiffPane`, a 4px drag handle, and `TerminalPanel` (height from the store) — the panel sits under the file pane only, leaving the sidebar full height (as in common editors). Height is clamped to `[120px, container − 160px]` while dragging and on window resize. The panel header has the tab strip, a "+" (new terminal) button, and a hide button; the toolbar gets a terminal toggle button with `aria-pressed`, disabled when no repo is open.

### Maximizing
The store holds `terminalMaximized` (session-only, not persisted) and `toggleTerminalMaximized`. `App` adds a `terminal-maximized` class to the workspace column while the panel is open and maximized; CSS then hides `DiffPane` (`display: none`, so its state and scroll positions survive) and lets the panel flex to fill the column, ignoring the stored height. The drag handle is not rendered while maximized, so restoring returns to the stored height untouched. The existing `ResizeObserver` refits the terminal to the new area. A header button toggles it.
- *Alternatives:* the OS full-screen window (hides the toolbar too and is a window-level concern, not a panel one); covering the sidebar as well (`Ctrl+B` already hides it, so the two compose).

### Shell exit closes the tab
When a session's exit notification arrives (any exit code), the registry reports `onExit` and the store calls `closeTerminal(id)` — the same path as the user closing it, so the last one hides the panel. No exit message is written, and there is no "exited" tab state. A shell that fails to *start* still keeps its tab, showing the error, since there is no session to have exited and the user needs to see why.

### Keyboard handling
- `handleShortcut` first checks whether the event target is inside a terminal (`closest("[data-terminal]")`). If so it handles only the panel toggle and returns `false` for everything else, so `Ctrl+R`, `Ctrl+W`, `Ctrl+B`, `Ctrl+Tab`, `[`/`]` reach the shell.
- Panel toggle matches `e.ctrlKey && e.code === "Backquote"` (layout-independent). It is also handled in xterm's `attachCustomKeyEventHandler`, which returns `false` so the key is not sent to the shell.
- `Ctrl+Shift+C` copies the selection and `Ctrl+Shift+V` pastes (via `navigator.clipboard`), handled in the same custom key handler; a context menu offers Copy/Paste. Plain `Ctrl+C` always goes to the shell.

### Theme
Build the xterm `theme` from the computed CSS custom properties (`--bg`, `--fg`, plus a selection colour) and re-apply on `matchMedia("(prefers-color-scheme: dark)")` change. ANSI palette uses xterm defaults in dark mode and a slightly darkened palette in light mode so yellow/white text stays readable.

### Capability and README wording
Update `capabilities/default.json`'s description to say the webview can start terminal sessions through the app's own commands (no fs/shell plugin permissions are added). README: add a Terminal section, the `` Ctrl+` `` shortcut, and clarify that Differential itself never modifies the repository while commands you run in the terminal can.

## Risks / Trade-offs

- [ConPTY quirks on Windows — reader not reaching EOF, stray escape sequences on resize] → waiter drops the master before joining the reader; integration test covers exit on Windows; resize debounced.
- [Orphaned processes after close/quit] → kill + drop master on close, `close_all` on `RunEvent::Exit`; manual check with a long-running child; Job Object fallback task.
- [Heavy output floods IPC and freezes the UI] → 64 KiB chunks over raw channels; xterm's write queue handles backpressure; manual test with a large `cat`/`Get-Content`.
- [Shortcut conflicts: users lose `Ctrl+R`/`Ctrl+W` when a terminal is focused] → intended (spec); clicking the file pane restores them.
- [Security: the webview can now start a shell] → only the bundled UI is loaded; the backend picks the executable and only accepts a directory; documented in the capability description. A future change adding remote content must revisit this.
- [Bundle size] → xterm adds roughly 300 KB minified; acceptable for a desktop app, and it can be lazy-loaded on first panel open.
- [Test environment: jsdom cannot render xterm] → mock `@xterm/xterm` in component tests; PTY behaviour is covered by Rust tests and manual checks.

## Migration Plan

Additive; no data migration. New localStorage keys default to "panel hidden". Rollback is reverting the change.

## Open Questions

- Should terminals created after a repository switch get a visual hint of which repository they belong to (e.g. the repo name in the tab title)? Can be added later without changing the approach.
